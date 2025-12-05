/**
 * Ankita PubSub System - Type Definitions
 *
 * Core types for the publish-subscribe messaging system
 */

// ============================================
// Message Types
// ============================================

export interface Message {
  id: string;
  topic: string;
  payload: unknown;
  timestamp: number;
  publisherId: string;
  headers?: Record<string, string>;
  replyTo?: string;  // For request/reply pattern
  correlationId?: string;  // Links request to reply
  ttl?: number;  // Time-to-live in ms
  retryCount?: number;
}

export interface QueuedMessage extends Message {
  subscriberId: string;
  queuedAt: number;
  attempts: number;
  maxRetries: number;
  nextRetryAt?: number;
}

// ============================================
// Topic Types
// ============================================

export interface Topic {
  name: string;
  createdAt: number;
  createdBy: string;
  messageCount: number;
  subscriberCount: number;
  config: TopicConfig;
}

export interface TopicConfig {
  maxQueueSize: number;  // Max messages to queue per subscriber
  messageRetention: number;  // How long to keep message history (ms)
  maxRetries: number;  // Max delivery retries
  retryDelay: number;  // Delay between retries (ms)
  requireAck: boolean;  // Require acknowledgment from subscribers
}

export const DEFAULT_TOPIC_CONFIG: TopicConfig = {
  maxQueueSize: 1000,
  messageRetention: 3600000,  // 1 hour
  maxRetries: 3,
  retryDelay: 5000,  // 5 seconds
  requireAck: false,
};

// ============================================
// Subscriber Types
// ============================================

export interface Subscriber {
  id: string;
  clientId: string;
  topics: Set<string>;
  createdAt: number;
  lastActivity: number;
  isOnline: boolean;
  pendingMessages: number;
  deliveredMessages: number;
  filter?: MessageFilter;
}

export interface MessageFilter {
  // Filter messages by header values
  headers?: Record<string, string | RegExp>;
  // Filter by payload fields (JSONPath-like)
  payload?: Record<string, unknown>;
}

// ============================================
// Publisher Types
// ============================================

export interface Publisher {
  id: string;
  clientId: string;
  createdAt: number;
  lastActivity: number;
  publishedMessages: number;
  topics: Set<string>;
}

// ============================================
// Authentication Types
// ============================================

export interface ApiKey {
  key: string;
  clientId: string;
  name: string;
  permissions: Permission[];
  createdAt: number;
  expiresAt?: number;
  rateLimit: RateLimit;
  isActive: boolean;
}

export type Permission =
  | 'publish'
  | 'subscribe'
  | 'admin'
  | 'topic:create'
  | 'topic:delete'
  | 'metrics:read';

export interface RateLimit {
  maxRequests: number;  // Max requests per window
  windowMs: number;  // Time window in ms
  currentRequests: number;
  windowStart: number;
}

export interface AuthResult {
  success: boolean;
  clientId?: string;
  permissions?: Permission[];
  error?: string;
}

// ============================================
// Request/Reply Types
// ============================================

export interface PendingRequest {
  correlationId: string;
  requesterId: string;
  topic: string;
  sentAt: number;
  timeout: number;
  resolve: (response: Message) => void;
  reject: (error: Error) => void;
}

// ============================================
// WebSocket Types
// ============================================

export type WSMessageType =
  | 'auth'
  | 'subscribe'
  | 'unsubscribe'
  | 'publish'
  | 'message'
  | 'ack'
  | 'request'
  | 'reply'
  | 'error'
  | 'ping'
  | 'pong'
  | 'topic:create'
  | 'topic:delete'
  | 'metrics';

export interface WSMessage {
  type: WSMessageType;
  id?: string;
  payload?: unknown;
  topic?: string;
  correlationId?: string;
  error?: string;
}

export interface WSClient {
  id: string;
  ws: WebSocket;
  clientId?: string;
  isAuthenticated: boolean;
  subscribedTopics: Set<string>;
  connectedAt: number;
  lastPing: number;
}

// ============================================
// Metrics Types
// ============================================

export interface BrokerMetrics {
  uptime: number;
  totalMessages: number;
  messagesPerSecond: number;
  activeConnections: number;
  totalTopics: number;
  totalSubscribers: number;
  queuedMessages: number;
  deadLetterCount: number;
  memoryUsage: NodeJS.MemoryUsage;
}

export interface TopicMetrics {
  name: string;
  messageCount: number;
  subscriberCount: number;
  messagesPerMinute: number;
  avgDeliveryTime: number;
  queueDepth: number;
}

// ============================================
// Event Types (Internal)
// ============================================

export type BrokerEvent =
  | { type: 'message:published'; message: Message }
  | { type: 'message:delivered'; message: Message; subscriberId: string }
  | { type: 'message:queued'; message: QueuedMessage }
  | { type: 'message:failed'; message: Message; error: string }
  | { type: 'subscriber:connected'; subscriber: Subscriber }
  | { type: 'subscriber:disconnected'; subscriberId: string }
  | { type: 'topic:created'; topic: Topic }
  | { type: 'topic:deleted'; topicName: string };

export type EventHandler = (event: BrokerEvent) => void;

// ============================================
// Dead Letter Queue Types
// ============================================

export interface DeadLetterMessage extends QueuedMessage {
  failureReason: string;
  failedAt: number;
  originalTopic: string;
}
