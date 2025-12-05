/**
 * Ankita PubSub System - Main Server
 *
 * HTTP + WebSocket server using Bun's built-in capabilities.
 * Provides REST API and real-time WebSocket connections.
 */

import type { ServerWebSocket } from 'bun';
import type { WSMessage, WSClient, Message } from './pubsub/types';
import { broker } from './pubsub/broker';
import { authManager } from './auth/auth';
import { logger as oldLogger } from './utils/logger';
import { consumerGroupManager } from './pubsub/consumer-group';
import { config, validateConfig, getConfigSummary } from './config';
import { logger, createRequestLogger, generateCorrelationId } from './logging';
import { metrics, timeRequest } from './metrics';
import { health, healthResponse } from './health';
import { audit } from './audit';

// Backwards compatible logger wrapper
const legacyLogger = {
  ...oldLogger,
  info: (msg: string, ctx?: Record<string, unknown>) => logger.info(msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => logger.warn(msg, ctx),
  error: (msg: string, err?: unknown, ctx?: Record<string, unknown>) => logger.error(msg, err, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => logger.debug(msg, ctx),
};

// ============================================
// Configuration
// ============================================

const PORT = config.server.port;
const HOST = config.server.host;

// ============================================
// WebSocket Client Management
// ============================================

const wsClients: Map<string, WSClient> = new Map();

function generateClientId(): string {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// WebSocket Message Handlers
// ============================================

function handleWSMessage(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  const client = ws.data;

  switch (data.type) {
    case 'auth':
      handleAuth(ws, data);
      break;

    case 'subscribe':
      handleSubscribe(ws, data);
      break;

    case 'unsubscribe':
      handleUnsubscribe(ws, data);
      break;

    case 'publish':
      handlePublish(ws, data);
      break;

    case 'request':
      handleRequest(ws, data);
      break;

    case 'reply':
      handleReply(ws, data);
      break;

    case 'ack':
      handleAck(ws, data);
      break;

    case 'topic:create':
      handleTopicCreate(ws, data);
      break;

    case 'topic:delete':
      handleTopicDelete(ws, data);
      break;

    case 'metrics':
      handleMetrics(ws);
      break;

    case 'ping':
      sendWS(ws, { type: 'pong' });
      client.lastPing = Date.now();
      break;

    case 'apikeys:list':
      handleApiKeysList(ws);
      break;

    case 'consumergroups:list':
      handleConsumerGroupsList(ws);
      break;

    case 'dlq:list':
      handleDLQList(ws);
      break;

    case 'dlq:retry':
      handleDLQRetry(ws, data);
      break;

    case 'dlq:retry-all':
      handleDLQRetryAll(ws);
      break;

    case 'dlq:delete':
      handleDLQDelete(ws, data);
      break;

    default:
      sendWS(ws, { type: 'error', error: `Unknown message type: ${data.type}` });
  }
}

function handleAuth(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  const apiKey = data.payload as string;
  const result = authManager.authenticate(apiKey);

  if (result.success) {
    ws.data.isAuthenticated = true;
    ws.data.clientId = result.clientId;
    sendWS(ws, {
      type: 'auth',
      payload: { success: true, clientId: result.clientId, permissions: result.permissions },
    });
    logger.info(`Client authenticated: ${result.clientId}`);
    audit.authSuccess(result.clientId!);
    metrics.inc('ankita_messages_delivered_total', 1, { topic: 'auth' });
  } else {
    sendWS(ws, { type: 'error', error: result.error });
    audit.authFailure(result.error || 'Unknown error');
  }
}

function handleSubscribe(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const topics = Array.isArray(data.payload) ? data.payload : [data.topic];

  if (!topics || topics.length === 0) {
    sendWS(ws, { type: 'error', error: 'No topics specified' });
    return;
  }

  const subscriber = broker.subscribe(
    ws.data.clientId!,
    topics as string[],
    (message: Message) => {
      sendWS(ws, { type: 'message', payload: message, topic: message.topic });
    }
  );

  for (const topic of topics) {
    ws.data.subscribedTopics.add(topic as string);
  }

  sendWS(ws, {
    type: 'subscribe',
    payload: { subscriberId: subscriber.id, topics },
  });

  logger.info(`Client ${ws.data.clientId} subscribed to: ${topics.join(', ')}`);
}

function handleUnsubscribe(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const topics = Array.isArray(data.payload) ? data.payload : [data.topic];

  // Find subscriber and unsubscribe
  const subscribers = broker.getSubscribers();
  const clientSubscriber = subscribers.find((s) => s.clientId === ws.data.clientId);

  if (clientSubscriber) {
    broker.unsubscribe(clientSubscriber.id, topics as string[]);
    for (const topic of topics) {
      ws.data.subscribedTopics.delete(topic as string);
    }
  }

  sendWS(ws, { type: 'unsubscribe', payload: { topics } });
}

function handlePublish(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  if (!data.topic) {
    sendWS(ws, { type: 'error', error: 'No topic specified' });
    return;
  }

  const message = broker.publish(data.topic, data.payload, ws.data.clientId!);

  // Track metrics
  metrics.inc('ankita_messages_published_total', 1, { topic: data.topic });

  sendWS(ws, { type: 'publish', payload: { messageId: message.id, topic: data.topic } });

  // Broadcast to dashboard clients
  broadcastMetrics();
}

async function handleRequest(ws: ServerWebSocket<WSClient>, data: WSMessage): Promise<void> {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  if (!data.topic) {
    sendWS(ws, { type: 'error', error: 'No topic specified' });
    return;
  }

  try {
    const response = await broker.request(
      data.topic,
      data.payload,
      ws.data.clientId!,
      30000 // 30 second timeout
    );

    sendWS(ws, {
      type: 'reply',
      payload: response.payload,
      correlationId: data.correlationId,
    });
  } catch (error) {
    sendWS(ws, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Request failed',
      correlationId: data.correlationId,
    });
  }
}

function handleReply(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  // The reply is sent through the normal publish mechanism
  // The broker handles routing it to the correct requester
  if (data.topic) {
    broker.publish(data.topic, data.payload, ws.data.clientId!, {
      correlationId: data.correlationId,
    });
  }
}

function handleAck(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const messageId = data.payload as string;
  const subscribers = broker.getSubscribers();
  const clientSubscriber = subscribers.find((s) => s.clientId === ws.data.clientId);

  if (clientSubscriber) {
    broker.ack(clientSubscriber.id, messageId);
  }
}

function handleTopicCreate(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const topicName = data.topic || (data.payload as string);
  if (!topicName) {
    sendWS(ws, { type: 'error', error: 'No topic name specified' });
    return;
  }

  try {
    const topic = broker.createTopic(topicName, ws.data.clientId!);
    sendWS(ws, { type: 'topic:create', payload: topic });
    audit.topicCreated(ws.data.clientId!, topicName);
    broadcastMetrics();
  } catch (error) {
    sendWS(ws, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Failed to create topic',
    });
  }
}

function handleTopicDelete(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const topicName = data.topic || (data.payload as string);
  if (!topicName) {
    sendWS(ws, { type: 'error', error: 'No topic name specified' });
    return;
  }

  const deleted = broker.deleteTopic(topicName);
  if (deleted) {
    audit.topicDeleted(ws.data.clientId!, topicName);
  }
  sendWS(ws, { type: 'topic:delete', payload: { deleted, topic: topicName } });
  broadcastMetrics();
}

function handleMetrics(ws: ServerWebSocket<WSClient>): void {
  const metrics = broker.getMetrics();
  const topics = broker.getAllTopics();
  const subscribers = broker.getSubscribers();

  sendWS(ws, {
    type: 'metrics',
    payload: { metrics, topics, subscribers },
  });
}

function handleApiKeysList(ws: ServerWebSocket<WSClient>): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const keys = authManager.getAllKeys().map((k) => ({
    name: k.name,
    key: k.key,
    role: k.role,
    permissions: k.permissions,
    rateLimit: k.rateLimit,
  }));

  sendWS(ws, { type: 'apikeys:list', payload: keys });
}

function handleConsumerGroupsList(ws: ServerWebSocket<WSClient>): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const stats = consumerGroupManager.getStats();
  sendWS(ws, { type: 'consumergroups:list', payload: stats.groupDetails });
}

function handleDLQList(ws: ServerWebSocket<WSClient>): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const dlq = broker.getDeadLetterQueue();
  sendWS(ws, { type: 'dlq:list', payload: dlq });
}

function handleDLQRetry(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const id = (data.payload as { id: string })?.id;
  if (id) {
    broker.retryDeadLetter(id);
    sendWS(ws, { type: 'dlq:retry', payload: { success: true, id } });
    broadcastMetrics();
  }
}

function handleDLQRetryAll(ws: ServerWebSocket<WSClient>): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  broker.retryAllDeadLetters();
  sendWS(ws, { type: 'dlq:retry-all', payload: { success: true } });
  broadcastMetrics();
}

function handleDLQDelete(ws: ServerWebSocket<WSClient>, data: WSMessage): void {
  if (!ws.data.isAuthenticated) {
    sendWS(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  const id = (data.payload as { id: string })?.id;
  if (id) {
    broker.deleteDeadLetter(id);
    sendWS(ws, { type: 'dlq:delete', payload: { success: true, id } });
    broadcastMetrics();
  }
}

// ============================================
// WebSocket Helpers
// ============================================

function sendWS(ws: ServerWebSocket<WSClient>, message: WSMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch (error) {
    logger.error('Failed to send WebSocket message:', error);
  }
}

function broadcastMetrics(): void {
  const metrics = broker.getMetrics();
  const topics = broker.getAllTopics();
  const subscribers = broker.getSubscribers();

  const message: WSMessage = {
    type: 'metrics',
    payload: { metrics, topics, subscribers },
  };

  for (const client of wsClients.values()) {
    if (client.isAuthenticated) {
      try {
        client.ws.send(JSON.stringify(message));
      } catch {
        // Client may have disconnected
      }
    }
  }
}

// ============================================
// HTTP Request Handlers
// ============================================

function handleHTTPRequest(req: Request): Response {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Serve static files
  if (path === '/' || path === '/index.html') {
    return serveStaticFile('public/index.html', 'text/html', corsHeaders);
  }

  if (path === '/style.css') {
    return serveStaticFile('public/style.css', 'text/css', corsHeaders);
  }

  if (path === '/app.js') {
    return serveStaticFile('public/app.js', 'application/javascript', corsHeaders);
  }

  if (path === '/logo.svg') {
    return serveStaticFile('public/logo.svg', 'image/svg+xml', corsHeaders);
  }

  if (path === '/openapi.yaml' || path === '/api/openapi') {
    return serveStaticFile('public/openapi.yaml', 'application/x-yaml', corsHeaders);
  }

  // Health and metrics endpoints (public, no /api prefix needed)
  if (path === '/health' || path === '/health/live' || path === '/health/ready') {
    return handleAPIRequest(req, path, corsHeaders);
  }

  if (path === '/metrics') {
    return handleAPIRequest(req, path, corsHeaders);
  }

  // API routes
  if (path.startsWith('/api/')) {
    return handleAPIRequest(req, path, corsHeaders);
  }

  return new Response('Not Found', { status: 404, headers: corsHeaders });
}

function serveStaticFile(
  filePath: string,
  contentType: string,
  headers: Record<string, string>
): Response {
  try {
    const file = Bun.file(filePath);
    return new Response(file, {
      headers: { ...headers, 'Content-Type': contentType },
    });
  } catch {
    return new Response('File not found', { status: 404, headers });
  }
}

async function handleAPIRequest(
  req: Request,
  path: string,
  headers: Record<string, string>
): Promise<Response> {
  const apiKey = req.headers.get('X-API-Key') || req.headers.get('Authorization')?.replace('Bearer ', '');

  // Public endpoints - Health checks
  if (path === config.health.livenessPath || path === '/health/live') {
    const status = await health.liveness();
    return healthResponse(status);
  }

  if (path === config.health.readinessPath || path === '/health/ready') {
    const status = await health.readiness();
    return healthResponse(status);
  }

  if (path === '/health' || path === '/api/health') {
    const status = await health.detailed();
    return healthResponse(status);
  }

  // Prometheus metrics endpoint
  if (path === config.metrics.path || path === '/metrics') {
    const metricsText = metrics.format();
    return new Response(metricsText, {
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (path === '/api/keys/demo') {
    // Return demo keys for testing
    const adminKey = authManager.getKeyByClientId('admin');
    const publisherKey = authManager.getKeyByClientId('publisher-1');
    const subscriberKey = authManager.getKeyByClientId('subscriber-1');
    const serviceKey = authManager.getKeyByClientId('service-1');

    return Response.json(
      {
        admin: adminKey?.key,
        publisher: publisherKey?.key,
        subscriber: subscriberKey?.key,
        service: serviceKey?.key,
      },
      { headers }
    );
  }

  // Protected endpoints require authentication
  if (!apiKey) {
    return Response.json({ error: 'API key required' }, { status: 401, headers });
  }

  const authResult = authManager.authenticate(apiKey);
  if (!authResult.success) {
    return Response.json({ error: authResult.error }, { status: 401, headers });
  }

  // Metrics endpoint
  if (path === '/api/metrics') {
    const metrics = broker.getMetrics();
    return Response.json(metrics, { headers });
  }

  // Topics endpoints
  if (path === '/api/topics') {
    if (req.method === 'GET') {
      const topics = broker.getAllTopics();
      return Response.json(topics, { headers });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      try {
        const topic = broker.createTopic(body.name, authResult.clientId!, body.config);
        return Response.json(topic, { status: 201, headers });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Failed to create topic' },
          { status: 400, headers }
        );
      }
    }
  }

  // Publish endpoint
  if (path === '/api/publish' && req.method === 'POST') {
    const body = await req.json();

    if (!body.topic) {
      return Response.json({ error: 'Topic required' }, { status: 400, headers });
    }

    const message = broker.publish(body.topic, body.payload, authResult.clientId!, {
      headers: body.headers,
      ttl: body.ttl,
    });

    broadcastMetrics();
    return Response.json({ messageId: message.id }, { headers });
  }

  // Subscribers endpoint
  if (path === '/api/subscribers') {
    const subscribers = broker.getSubscribers();
    return Response.json(subscribers, { headers });
  }

  // Dead letter queue endpoint
  if (path === '/api/dlq') {
    const dlq = broker.getDeadLetterQueue();
    return Response.json(dlq, { headers });
  }

  // Message history endpoint
  if (path.startsWith('/api/messages/')) {
    const topic = path.replace('/api/messages/', '');
    const messages = broker.getMessageHistory(topic);
    return Response.json(messages, { headers });
  }

  return Response.json({ error: 'Not found' }, { status: 404, headers });
}

// ============================================
// Server Setup
// ============================================

const server = Bun.serve<WSClient>({
  port: PORT,
  hostname: HOST,

  fetch(req, server) {
    // Upgrade WebSocket connections
    if (req.headers.get('upgrade') === 'websocket') {
      const clientId = generateClientId();

      const success = server.upgrade(req, {
        data: {
          id: clientId,
          ws: null as unknown as WebSocket,
          isAuthenticated: false,
          subscribedTopics: new Set<string>(),
          connectedAt: Date.now(),
          lastPing: Date.now(),
        } as WSClient,
      });

      if (success) {
        return undefined;
      }
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // Handle HTTP requests
    return handleHTTPRequest(req);
  },

  websocket: {
    open(ws) {
      ws.data.ws = ws as unknown as WebSocket;
      wsClients.set(ws.data.id, ws.data);
      logger.info(`WebSocket connected: ${ws.data.id}`);
    },

    message(ws, message) {
      try {
        // Handle both string and Buffer messages
        const messageStr = typeof message === 'string' ? message : message.toString();
        const data = JSON.parse(messageStr) as WSMessage;
        handleWSMessage(ws, data);
      } catch (error) {
        console.error('WebSocket message parse error:', error, 'Raw message:', message);
        sendWS(ws, { type: 'error', error: 'Invalid JSON message' });
      }
    },

    close(ws) {
      wsClients.delete(ws.data.id);

      // Clean up subscriptions - fully unsubscribe when WS closes
      if (ws.data.clientId) {
        const subscribers = broker.getSubscribers();
        for (const subscriber of subscribers) {
          if (subscriber.clientId === ws.data.clientId) {
            // Fully remove the subscriber instead of just marking offline
            broker.unsubscribe(subscriber.id);
          }
        }
      }

      logger.info(`WebSocket disconnected: ${ws.data.id}`);
      broadcastMetrics();
    },

    drain(ws) {
      logger.debug(`WebSocket backpressure relieved: ${ws.data.id}`);
    },
  },
});

// ============================================
// Broker Event Logging
// ============================================

broker.on((event) => {
  switch (event.type) {
    case 'message:published':
      logger.debug(`Message published to ${event.message.topic}: ${event.message.id}`);
      break;
    case 'message:delivered':
      logger.debug(`Message delivered: ${event.message.id} -> ${event.subscriberId}`);
      break;
    case 'topic:created':
      logger.info(`Topic created: ${event.topic.name}`);
      break;
    case 'topic:deleted':
      logger.info(`Topic deleted: ${event.topicName}`);
      break;
  }
});

// ============================================
// Graceful Shutdown
// ============================================

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Mark service as not ready
  health.setReady(false);

  // Give time for health checks to propagate
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Close all WebSocket connections
  logger.info('Closing WebSocket connections...');
  for (const client of wsClients.values()) {
    try {
      client.ws.close(1001, 'Server shutting down');
    } catch {
      // Client may already be disconnected
    }
  }

  // Stop the server
  logger.info('Stopping HTTP server...');
  server.stop();

  logger.info('Shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================
// Startup
// ============================================

// Validate configuration in production
const configErrors = validateConfig();
if (configErrors.length > 0) {
  for (const error of configErrors) {
    logger.error(`Configuration error: ${error}`);
  }
  if (config.server.env === 'production') {
    process.exit(1);
  }
}

oldLogger.section('Ankita PubSub Server');
logger.info('Server starting', {
  host: HOST,
  port: PORT,
  environment: config.server.env,
});
logger.info(`HTTP: http://${HOST}:${PORT}`);
logger.info(`WebSocket: ws://${HOST}:${PORT}`);
logger.info(`Dashboard: http://${HOST}:${PORT}/`);
logger.info(`Metrics: http://${HOST}:${PORT}${config.metrics.path}`);
logger.info(`Health: http://${HOST}:${PORT}${config.health.readinessPath}`);
oldLogger.separator();

// Create some default topics
broker.createTopic('system.events', 'system');
broker.createTopic('orders.created', 'system');
broker.createTopic('orders.updated', 'system');
broker.createTopic('notifications', 'system');

logger.info('Default topics created');
oldLogger.separator();

// Log demo API keys
logger.info('Demo API Keys:');
const demoKeys = authManager.getAllKeys();
for (const key of demoKeys) {
  logger.info(`  ${key.name}: ${key.key}`);
}
oldLogger.separator();

// Mark service as ready
health.setReady(true);
logger.info('Service ready to accept connections');

export { server };
