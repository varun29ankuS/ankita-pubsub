/**
 * Ankita PubSub System - Demo Simulator
 *
 * Simulates multiple publishers and subscribers to demonstrate
 * the system's capabilities. Run with: bun src/demo/simulator.ts
 */

import { broker } from '../pubsub/broker';
import { authManager } from '../auth/auth';
import { logger } from '../utils/logger';
import type { Message } from '../pubsub/types';

// ============================================
// Configuration
// ============================================

const SIMULATION_CONFIG = {
  publishInterval: 1000,      // Publish every 1 second
  requestInterval: 5000,      // Send request every 5 seconds
  batchSize: 3,               // Messages per batch
  duration: 60000,            // Run for 60 seconds (0 for infinite)
};

// ============================================
// Simulated Services
// ============================================

class OrderService {
  private orderId = 1000;

  generateOrder() {
    return {
      orderId: `ORD-${this.orderId++}`,
      customerId: `CUST-${Math.floor(Math.random() * 100)}`,
      items: [
        { sku: 'PROD-001', quantity: Math.floor(Math.random() * 5) + 1 },
        { sku: 'PROD-002', quantity: Math.floor(Math.random() * 3) + 1 },
      ],
      total: Math.floor(Math.random() * 500) + 50,
      status: 'created',
      createdAt: new Date().toISOString(),
    };
  }

  start() {
    logger.info('OrderService started - publishing to orders.created');

    setInterval(() => {
      const order = this.generateOrder();
      broker.publish('orders.created', order, 'order-service');
      logger.debug(`Order created: ${order.orderId}`);
    }, SIMULATION_CONFIG.publishInterval);
  }
}

class InventoryService {
  private inventory: Map<string, number> = new Map([
    ['PROD-001', 100],
    ['PROD-002', 50],
    ['PROD-003', 75],
  ]);

  start() {
    logger.info('InventoryService started - subscribing to orders.created');

    broker.subscribe('inventory-service', ['orders.created'], (message: Message) => {
      this.handleOrder(message);
    });

    // Also respond to inventory queries (request/reply)
    broker.subscribe('inventory-service', ['inventory.query'], (message: Message) => {
      this.handleQuery(message);
    });
  }

  private handleOrder(message: Message) {
    const order = message.payload as { items: { sku: string; quantity: number }[] };

    for (const item of order.items) {
      const current = this.inventory.get(item.sku) || 0;
      this.inventory.set(item.sku, Math.max(0, current - item.quantity));

      broker.publish('inventory.updated', {
        sku: item.sku,
        previousStock: current,
        newStock: this.inventory.get(item.sku),
        changedBy: message.id,
      }, 'inventory-service');
    }

    logger.debug(`Inventory updated for order`);
  }

  private handleQuery(message: Message) {
    if (message.replyTo) {
      const query = message.payload as { sku?: string };

      let response;
      if (query.sku) {
        response = {
          sku: query.sku,
          stock: this.inventory.get(query.sku) || 0,
        };
      } else {
        response = {
          inventory: Object.fromEntries(this.inventory),
        };
      }

      broker.reply(message, response, 'inventory-service');
      logger.debug(`Replied to inventory query`);
    }
  }
}

class NotificationService {
  private notificationCount = 0;

  start() {
    logger.info('NotificationService started - subscribing to orders.created');

    broker.subscribe('notification-service', ['orders.created'], (message: Message) => {
      this.handleOrder(message);
    });
  }

  private handleOrder(message: Message) {
    const order = message.payload as { orderId: string; customerId: string };

    // Simulate sending notification
    this.notificationCount++;

    broker.publish('notifications', {
      type: 'order_confirmation',
      orderId: order.orderId,
      customerId: order.customerId,
      channel: 'email',
      sentAt: new Date().toISOString(),
    }, 'notification-service');

    logger.debug(`Notification sent for order ${order.orderId}`);
  }

  getStats() {
    return { notificationsSent: this.notificationCount };
  }
}

class AnalyticsService {
  private eventCount = 0;
  private orderTotal = 0;

  start() {
    logger.info('AnalyticsService started - subscribing to all events');

    // Subscribe to multiple topics
    broker.subscribe('analytics-service', [
      'orders.created',
      'inventory.updated',
      'notifications',
    ], (message: Message) => {
      this.trackEvent(message);
    });
  }

  private trackEvent(message: Message) {
    this.eventCount++;

    if (message.topic === 'orders.created') {
      const order = message.payload as { total: number };
      this.orderTotal += order.total;
    }

    // Periodically publish analytics
    if (this.eventCount % 10 === 0) {
      broker.publish('system.events', {
        type: 'analytics_update',
        totalEvents: this.eventCount,
        orderRevenue: this.orderTotal,
        timestamp: Date.now(),
      }, 'analytics-service');
    }
  }

  getStats() {
    return {
      totalEvents: this.eventCount,
      orderRevenue: this.orderTotal,
    };
  }
}

// ============================================
// Request/Reply Demo
// ============================================

async function demoRequestReply() {
  logger.info('Starting request/reply demo...');

  try {
    // Query all inventory
    const response = await broker.request(
      'inventory.query',
      { action: 'getAll' },
      'demo-client',
      5000
    );

    logger.info('Inventory query response:', response.payload);
  } catch (error) {
    logger.error('Request failed:', error);
  }
}

// ============================================
// Main Simulation
// ============================================

async function main() {
  logger.section('Ankita PubSub - Demo Simulator');

  // Create services
  const orderService = new OrderService();
  const inventoryService = new InventoryService();
  const notificationService = new NotificationService();
  const analyticsService = new AnalyticsService();

  // Start subscribers first
  inventoryService.start();
  notificationService.start();
  analyticsService.start();

  // Wait a bit for subscriptions to be set up
  await new Promise(resolve => setTimeout(resolve, 100));

  // Start publisher
  orderService.start();

  // Run request/reply demo periodically
  setInterval(() => {
    demoRequestReply();
  }, SIMULATION_CONFIG.requestInterval);

  // Log metrics periodically
  setInterval(() => {
    const metrics = broker.getMetrics();
    logger.separator();
    logger.info('=== Metrics ===');
    logger.info(`Total Messages: ${metrics.totalMessages}`);
    logger.info(`Messages/sec: ${metrics.messagesPerSecond}`);
    logger.info(`Topics: ${metrics.totalTopics}`);
    logger.info(`Subscribers: ${metrics.totalSubscribers}`);
    logger.info(`Queued: ${metrics.queuedMessages}`);
    logger.info(`Dead Letter: ${metrics.deadLetterCount}`);
    logger.info(`Analytics: ${JSON.stringify(analyticsService.getStats())}`);
    logger.separator();
  }, 10000);

  // Stop after duration (if set)
  if (SIMULATION_CONFIG.duration > 0) {
    setTimeout(() => {
      logger.section('Simulation Complete');
      logger.info('Final Metrics:', broker.getMetrics());
      process.exit(0);
    }, SIMULATION_CONFIG.duration);
  }

  logger.info('Simulation running... Press Ctrl+C to stop');
}

// Run if called directly
main().catch(console.error);
