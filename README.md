# Ankita PubSub System

A production-ready **Publisher-Subscriber messaging system** built with Bun and TypeScript. Includes a real-time dashboard for monitoring and testing.

## Features

- **Topic-based Messaging** - Publish and subscribe to named topics
- **Message Queueing** - Offline subscribers receive messages when they reconnect
- **Request/Reply Pattern** - Synchronous request-response over async messaging
- **Dead Letter Queue** - Failed messages are captured for debugging
- **API Key Authentication** - Secure access with rate limiting
- **Real-time Dashboard** - Visual monitoring of all system activity
- **WebSocket Support** - Low-latency real-time communication

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Publisher  │────▶│                 │────▶│  Subscriber  │
│  (HTTP/WS)  │     │  Message Broker │     │  (Callback)  │
└─────────────┘     │                 │     └──────────────┘
                    │  - Topics       │
┌─────────────┐     │  - Queues       │     ┌──────────────┐
│  Publisher  │────▶│  - Routing      │────▶│  Subscriber  │
└─────────────┘     └────────┬────────┘     └──────────────┘
                             │
                             │ WebSocket
                             ▼
                    ┌─────────────────┐
                    │    Dashboard    │
                    │  - Live msgs    │
                    │  - Topic stats  │
                    │  - Subscribers  │
                    └─────────────────┘
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
bun run dev
```

### Access the Dashboard

Open http://localhost:3000 in your browser.

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

#### Health Check

```bash
GET /api/health
```

#### Get Metrics

```bash
GET /api/metrics
Headers: X-API-Key: YOUR_API_KEY
```

#### List Topics

```bash
GET /api/topics
Headers: X-API-Key: YOUR_API_KEY
```

#### Create Topic

```bash
POST /api/topics
Headers: X-API-Key: YOUR_API_KEY
Content-Type: application/json

{ "name": "my.topic", "config": { "maxQueueSize": 1000 } }
```

#### Publish Message

```bash
POST /api/publish
Headers: X-API-Key: YOUR_API_KEY
Content-Type: application/json

{ "topic": "orders.created", "payload": { "data": "value" } }
```

#### Get Demo API Keys

```bash
GET /api/keys/demo
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | localhost | Server host |

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

## Project Structure

```
ankita-pubsub/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── pubsub/
│   │   ├── broker.ts         # Core message broker
│   │   ├── topic.ts          # Topic management
│   │   ├── queue.ts          # Message queue
│   │   └── types.ts          # TypeScript interfaces
│   ├── auth/
│   │   └── auth.ts           # API key authentication
│   ├── utils/
│   │   └── logger.ts         # Logging utility
│   └── demo/
│       └── simulator.ts      # Demo simulation
├── public/
│   ├── index.html            # Dashboard HTML
│   ├── style.css             # Dashboard styles
│   └── app.js                # Dashboard frontend
├── package.json
├── tsconfig.json
└── README.md
```

## Key Concepts

### Topics

Topics are named channels for messages. Use dot notation for hierarchy:

- `orders.created`
- `orders.updated`
- `inventory.stock.low`

### Message Flow

1. **Publisher** sends a message to a topic
2. **Broker** routes the message to all subscribers
3. **Online subscribers** receive immediately
4. **Offline subscribers** get messages queued

### Request/Reply Pattern

For synchronous operations over async messaging:

1. Requester publishes to a topic with a `replyTo` topic
2. Responder subscribes, processes, and calls `broker.reply()`
3. Requester receives response on their reply topic

### Dead Letter Queue

Messages that fail delivery after max retries are moved to the DLQ:
- Queue overflow
- Delivery errors
- Max retries exceeded

## Scaling Considerations

This is an in-memory implementation for educational purposes. For production scale:

1. **Persistence** - Add Redis or PostgreSQL for message storage
2. **Clustering** - Use Redis Pub/Sub for multi-node coordination
3. **Partitioning** - Shard topics across nodes
4. **Backpressure** - Implement flow control

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

### Topic Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `maxQueueSize` | 1000 | Max messages per subscriber queue |
| `messageRetention` | 3600000 | Message history retention (ms) |
| `maxRetries` | 3 | Max delivery attempts |
| `retryDelay` | 5000 | Delay between retries (ms) |
| `requireAck` | false | Require message acknowledgment |

## License

MIT
