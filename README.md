<p align="center">
  <img src="public/logo.svg" alt="Ankita PubSub" width="120" height="120">
</p>

<h1 align="center">Ankita PubSub System</h1>

<p align="center">
  A production-ready <strong>Publisher-Subscriber messaging system</strong> built with Bun and TypeScript.<br>
  Features enterprise-grade monitoring, Prometheus metrics, health checks, and a real-time dashboard.
</p>

## Features

### Core Messaging
- **Topic-based Messaging** - Publish and subscribe to named topics with dot-notation hierarchy
- **Message Queueing** - Offline subscribers receive messages when they reconnect
- **Request/Reply Pattern** - Synchronous request-response over async messaging
- **Consumer Groups** - Load-balanced message consumption with round-robin distribution
- **Dead Letter Queue** - Failed messages captured for debugging and retry

### Enterprise Features
- **API Key Authentication** - Secure access with role-based permissions and rate limiting
- **Prometheus Metrics** - Export metrics for monitoring and alerting
- **Health Checks** - Kubernetes-compatible liveness and readiness probes
- **Structured Logging** - JSON logging with correlation IDs for traceability
- **Audit Logging** - Security event tracking for compliance
- **Graceful Shutdown** - Clean shutdown handling for zero-downtime deployments
- **SQLite Persistence** - Message and configuration storage

### Dashboard
- **Real-time Monitoring** - Live message feed and throughput charts
- **Topic Management** - Create, view, and manage topics
- **Subscriber Overview** - Monitor connected clients and their subscriptions
- **Health Status** - Visual health check dashboard
- **Prometheus Preview** - View and copy metrics endpoint configuration
- **System Info** - Memory usage, uptime, and configuration display
- **Audit Log** - Security event viewer

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Publisher  │────▶│                 │────▶│  Subscriber  │
│  (HTTP/WS)  │     │  Message Broker │     │  (Callback)  │
└─────────────┘     │                 │     └──────────────┘
                    │  - Topics       │
┌─────────────┐     │  - Queues       │     ┌──────────────┐
│  Publisher  │────▶│  - Routing      │────▶│  Subscriber  │
└─────────────┘     │  - Persistence  │     └──────────────┘
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌─────────────┐  ┌───────────┐  ┌───────────┐
     │  Dashboard  │  │  Metrics  │  │  Health   │
     │  (WebSocket)│  │ /metrics  │  │  /health  │
     └─────────────┘  └───────────┘  └───────────┘
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or later

### Installation

```bash
# Clone the repository
git clone https://github.com/varun29ankuS/ankita-pubsub.git
cd ankita-pubsub

# Install dependencies
bun install

# Start the server
bun run start
```

### Access Points

| Endpoint | URL | Description |
|----------|-----|-------------|
| Dashboard | http://localhost:3000 | Real-time monitoring UI |
| Metrics | http://localhost:3000/metrics | Prometheus metrics |
| Health | http://localhost:3000/health | Detailed health status |
| Liveness | http://localhost:3000/health/live | Kubernetes liveness probe |
| Readiness | http://localhost:3000/health/ready | Kubernetes readiness probe |
| OpenAPI | http://localhost:3000/openapi.yaml | API documentation |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment (development/staging/production) |
| `PORT` | 3000 | Server port |
| `HOST` | localhost | Server host |
| `ADMIN_API_KEY` | (auto-generated) | Admin API key |
| `JWT_SECRET` | (auto-generated) | JWT signing secret |
| `RATE_LIMIT_REQUESTS` | 1000 | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | 60000 | Rate limit window (ms) |
| `MAX_QUEUE_SIZE` | 10000 | Max messages per subscriber queue |
| `MAX_MESSAGE_SIZE` | 1048576 | Max message size (bytes) |
| `MESSAGE_RETENTION_MS` | 86400000 | Message retention (24 hours) |
| `LOG_LEVEL` | info | Logging level (debug/info/warn/error) |
| `LOG_FORMAT` | json | Log format (json/pretty) |
| `METRICS_ENABLED` | true | Enable Prometheus metrics |

## Usage

### WebSocket API

Connect to `ws://localhost:3000` and send JSON messages:

#### Authentication

```json
{ "type": "auth", "payload": "YOUR_API_KEY" }
```

#### Subscribe to Topics

```json
{ "type": "subscribe", "payload": ["orders.created", "notifications"] }
```

#### Publish a Message

```json
{
  "type": "publish",
  "topic": "orders.created",
  "payload": { "orderId": "123", "total": 99.99 }
}
```

#### Request/Reply

```json
{
  "type": "request",
  "topic": "inventory.query",
  "payload": { "sku": "PROD-001" },
  "correlationId": "req_123"
}
```

### REST API

#### Health Endpoints (Public)

```bash
# Detailed health status
GET /health

# Kubernetes liveness probe
GET /health/live

# Kubernetes readiness probe
GET /health/ready
```

#### Prometheus Metrics (Public)

```bash
GET /metrics
```

#### Demo API Keys (Public)

```bash
GET /api/keys/demo
```

#### Protected Endpoints

All protected endpoints require the `X-API-Key` header.

```bash
# Get system metrics
GET /api/metrics

# List topics
GET /api/topics

# Create topic
POST /api/topics
Content-Type: application/json
{ "name": "my.topic", "config": { "maxQueueSize": 1000 } }

# Publish message
POST /api/publish
Content-Type: application/json
{ "topic": "orders.created", "payload": { "data": "value" } }

# List subscribers
GET /api/subscribers

# Get dead letter queue
GET /api/dlq

# Get message history
GET /api/messages/{topic}
```

## Demo Simulator

Run the demo to see the system in action:

```bash
bun run demo
```

This simulates:
- **OrderService** - Creates orders every second
- **InventoryService** - Updates stock on new orders
- **NotificationService** - Sends notifications
- **AnalyticsService** - Tracks all events

## Testing

```bash
# Run all tests
bun test

# Run unit tests only
bun test:unit

# Run integration tests
bun test:integration

# Type checking
bun run typecheck
```

## Project Structure

```
ankita-pubsub/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── pubsub/
│   │   ├── broker.ts         # Core message broker
│   │   ├── topic.ts          # Topic management
│   │   ├── queue.ts          # Message queue
│   │   ├── consumer-group.ts # Consumer group management
│   │   └── types.ts          # TypeScript interfaces
│   ├── auth/
│   │   └── auth.ts           # API key authentication
│   ├── storage/
│   │   └── database.ts       # SQLite persistence layer
│   ├── config/
│   │   └── index.ts          # Environment configuration
│   ├── logging/
│   │   └── index.ts          # Structured JSON logging
│   ├── metrics/
│   │   └── index.ts          # Prometheus metrics
│   ├── health/
│   │   └── index.ts          # Health check system
│   ├── audit/
│   │   └── index.ts          # Audit logging
│   ├── utils/
│   │   └── logger.ts         # Legacy logging utility
│   └── demo/
│       └── simulator.ts      # Demo simulation
├── public/
│   ├── index.html            # Dashboard HTML
│   ├── style.css             # Dashboard styles
│   ├── app.js                # Dashboard frontend
│   └── openapi.yaml          # OpenAPI specification
├── tests/
│   ├── broker.test.ts        # Broker unit tests
│   ├── auth.test.ts          # Auth unit tests
│   └── health.test.ts        # Health integration tests
├── package.json
├── tsconfig.json
└── README.md
```

## Prometheus Integration

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'ankita-pubsub'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `ankita_messages_published_total` | Counter | Total messages published |
| `ankita_messages_delivered_total` | Counter | Total messages delivered |
| `ankita_messages_failed_total` | Counter | Failed deliveries |
| `ankita_active_connections` | Gauge | WebSocket connections |
| `ankita_topics_total` | Gauge | Number of topics |
| `ankita_dead_letter_queue_size` | Gauge | DLQ size |
| `ankita_uptime_seconds` | Gauge | Server uptime |
| `ankita_memory_heap_used_bytes` | Gauge | Heap memory usage |

## Kubernetes Deployment

Example deployment with health probes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ankita-pubsub
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: ankita-pubsub
        image: ankita-pubsub:latest
        ports:
        - containerPort: 3000
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "3000"
```

## Key Concepts

### Topics

Topics are named channels for messages. Use dot notation for hierarchy:

- `orders.created`
- `orders.updated`
- `inventory.stock.low`

### Consumer Groups

Consumer groups enable load-balanced message consumption:

- Messages are distributed across group members
- Each message is delivered to only one member
- Supports round-robin and broadcast strategies

### Dead Letter Queue

Messages that fail delivery after max retries are moved to the DLQ:
- Queue overflow
- Delivery errors
- Max retries exceeded

Messages can be retried or deleted from the dashboard.

## API Reference

### WebSocket Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `auth` | Client → Server | Authenticate with API key |
| `subscribe` | Client → Server | Subscribe to topics |
| `unsubscribe` | Client → Server | Unsubscribe from topics |
| `publish` | Client → Server | Publish a message |
| `message` | Server → Client | Incoming message |
| `request` | Client → Server | Send request (req/reply) |
| `reply` | Server → Client | Receive reply |
| `ack` | Client → Server | Acknowledge message |
| `metrics` | Bidirectional | System metrics |
| `error` | Server → Client | Error notification |

### API Key Permissions

| Permission | Description |
|------------|-------------|
| `admin` | Full access to all operations |
| `publish` | Can publish messages |
| `subscribe` | Can subscribe to topics |

## License

Apache License 2.0
