/**
 * Ankita PubSub System - Message Broker
 *
 * Core message broker that orchestrates publishing, subscribing,
 * message routing, and the request/reply pattern.
 */

import type {
  Message,
  QueuedMessage,
  Subscriber,
  Publisher,
  Topic,
  TopicConfig,
  BrokerEvent,
  EventHandler,
  PendingRequest,
  BrokerMetrics,
} from './types';
import { MessageQueue } from './queue';
import { TopicManager } from './topic';

export class MessageBroker {
  private topicManager: TopicManager;
  private messageQueue: MessageQueue;
  private subscribers: Map<string, Subscriber> = new Map();
  private publishers: Map<string, Publisher> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private eventHandlers: Set<EventHandler> = new Set();
  private messageCallbacks: Map<string, (message: Message) => void> = new Map();

  // Metrics
  private startTime: number = Date.now();
  private totalMessages: number = 0;
  private messagesLastMinute: number[] = [];
  private readonly REQUEST_TIMEOUT_DEFAULT = 30000; // 30 seconds

  constructor() {
    this.topicManager = new TopicManager();
    this.messageQueue = new MessageQueue();

    // Start periodic cleanup
    this.startCleanupInterval();
  }

  // ============================================
  // Topic Management
  // ============================================

  createTopic(name: string, createdBy: string, config?: Partial<TopicConfig>): Topic {
    const topic = this.topicManager.createTopic(name, createdBy, config);
    this.emit({ type: 'topic:created', topic });
    return topic;
  }

  deleteTopic(name: string): boolean {
    const deleted = this.topicManager.deleteTopic(name);
    if (deleted) {
      this.emit({ type: 'topic:deleted', topicName: name });
    }
    return deleted;
  }

  getTopic(name: string): Topic | undefined {
    return this.topicManager.getTopic(name);
  }

  getAllTopics(): Topic[] {
    return this.topicManager.getAllTopics();
  }

  // ============================================
  // Publishing
  // ============================================

  publish(
    topic: string,
    payload: unknown,
    publisherId: string,
    options: {
      headers?: Record<string, string>;
      ttl?: number;
      correlationId?: string;
      replyTo?: string;
    } = {}
  ): Message {
    // Auto-create topic if it doesn't exist
    if (!this.topicManager.hasTopic(topic)) {
      this.topicManager.createTopic(topic, publisherId);
    }

    const message: Message = {
      id: this.generateId(),
      topic,
      payload,
      timestamp: Date.now(),
      publisherId,
      headers: options.headers,
      ttl: options.ttl,
      correlationId: options.correlationId,
      replyTo: options.replyTo,
    };

    // Record in topic history
    this.topicManager.recordMessage(message);

    // Track publisher stats
    this.trackPublisher(publisherId, topic);

    // Route to subscribers
    this.routeMessage(message);

    // Update metrics
    this.totalMessages++;
    this.messagesLastMinute.push(Date.now());

    this.emit({ type: 'message:published', message });

    return message;
  }

  private routeMessage(message: Message): void {
    const subscriberIds = this.topicManager.getSubscribers(message.topic);

    // Also get wildcard subscribers (subscribed to '#')
    const wildcardSubscriberIds = this.topicManager.getSubscribers('#');

    // Combine and deduplicate
    const allSubscriberIds = new Set([...subscriberIds, ...wildcardSubscriberIds]);

    for (const subscriberId of allSubscriberIds) {
      const subscriber = this.subscribers.get(subscriberId);

      if (!subscriber) continue;

      // Check if subscriber has a message filter
      if (subscriber.filter && !this.matchesFilter(message, subscriber.filter)) {
        continue;
      }

      if (subscriber.isOnline) {
        // Deliver immediately
        this.deliverMessage(subscriberId, message);
      } else {
        // Queue for later delivery
        this.queueMessage(subscriberId, message);
      }
    }
  }

  private deliverMessage(subscriberId: string, message: Message): void {
    const callback = this.messageCallbacks.get(subscriberId);
    if (callback) {
      try {
        callback(message);
        const subscriber = this.subscribers.get(subscriberId);
        if (subscriber) {
          subscriber.deliveredMessages++;
          subscriber.lastActivity = Date.now();
        }
        this.emit({ type: 'message:delivered', message, subscriberId });
      } catch (error) {
        // If delivery fails, queue the message
        this.queueMessage(subscriberId, message);
        this.emit({
          type: 'message:failed',
          message,
          error: error instanceof Error ? error.message : 'Delivery failed',
        });
      }
    }
  }

  private queueMessage(subscriberId: string, message: Message): void {
    const topic = this.topicManager.getTopic(message.topic);
    const config = topic?.config;

    const queuedMessage: QueuedMessage = {
      ...message,
      subscriberId,
      queuedAt: Date.now(),
      attempts: 0,
      maxRetries: config?.maxRetries || 3,
    };

    this.messageQueue.enqueue(subscriberId, queuedMessage);

    const subscriber = this.subscribers.get(subscriberId);
    if (subscriber) {
      subscriber.pendingMessages = this.messageQueue.getQueueDepth(subscriberId);
    }

    this.emit({ type: 'message:queued', message: queuedMessage });
  }

  private matchesFilter(message: Message, filter: Subscriber['filter']): boolean {
    if (!filter) return true;

    // Check header filters
    if (filter.headers) {
      for (const [key, pattern] of Object.entries(filter.headers)) {
        const value = message.headers?.[key];
        if (!value) return false;

        if (pattern instanceof RegExp) {
          if (!pattern.test(value)) return false;
        } else if (value !== pattern) {
          return false;
        }
      }
    }

    // Check payload filters (simple key matching)
    if (filter.payload && typeof message.payload === 'object' && message.payload !== null) {
      for (const [key, expected] of Object.entries(filter.payload)) {
        const actual = (message.payload as Record<string, unknown>)[key];
        if (actual !== expected) return false;
      }
    }

    return true;
  }

  // ============================================
  // Subscribing
  // ============================================

  subscribe(
    clientId: string,
    topics: string[],
    callback: (message: Message) => void,
    filter?: Subscriber['filter']
  ): Subscriber {
    const subscriberId = `sub_${clientId}_${this.generateId()}`;

    const subscriber: Subscriber = {
      id: subscriberId,
      clientId,
      topics: new Set(topics),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isOnline: true,
      pendingMessages: 0,
      deliveredMessages: 0,
      filter,
    };

    this.subscribers.set(subscriberId, subscriber);
    this.messageCallbacks.set(subscriberId, callback);

    // Subscribe to each topic
    for (const topic of topics) {
      // Auto-create topic if needed
      if (!this.topicManager.hasTopic(topic)) {
        this.topicManager.createTopic(topic, clientId);
      }
      this.topicManager.addSubscriber(topic, subscriberId);
    }

    this.emit({ type: 'subscriber:connected', subscriber });

    // Deliver any queued messages
    this.drainQueue(subscriberId);

    return subscriber;
  }

  unsubscribe(subscriberId: string, topics?: string[]): boolean {
    const subscriber = this.subscribers.get(subscriberId);
    if (!subscriber) return false;

    if (topics) {
      // Unsubscribe from specific topics
      for (const topic of topics) {
        this.topicManager.removeSubscriber(topic, subscriberId);
        subscriber.topics.delete(topic);
      }
    } else {
      // Unsubscribe from all topics
      this.topicManager.removeSubscriberFromAll(subscriberId);
      this.subscribers.delete(subscriberId);
      this.messageCallbacks.delete(subscriberId);
      this.emit({ type: 'subscriber:disconnected', subscriberId });
    }

    return true;
  }

  setSubscriberOnline(subscriberId: string, online: boolean): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (subscriber) {
      subscriber.isOnline = online;
      subscriber.lastActivity = Date.now();

      if (online) {
        // Deliver queued messages
        this.drainQueue(subscriberId);
      }
    }
  }

  private drainQueue(subscriberId: string): void {
    let message: QueuedMessage | undefined;
    while ((message = this.messageQueue.dequeue(subscriberId))) {
      this.deliverMessage(subscriberId, message);
    }

    const subscriber = this.subscribers.get(subscriberId);
    if (subscriber) {
      subscriber.pendingMessages = this.messageQueue.getQueueDepth(subscriberId);
    }
  }

  // ============================================
  // Request/Reply Pattern
  // ============================================

  async request(
    topic: string,
    payload: unknown,
    requesterId: string,
    timeout: number = this.REQUEST_TIMEOUT_DEFAULT
  ): Promise<Message> {
    const correlationId = this.generateId();
    const replyTopic = `_reply.${requesterId}.${correlationId}`;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        this.unsubscribeFromReply(replyTopic, requesterId);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      // Store pending request
      const pendingRequest: PendingRequest = {
        correlationId,
        requesterId,
        topic,
        sentAt: Date.now(),
        timeout,
        resolve: (response: Message) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(correlationId);
          this.unsubscribeFromReply(replyTopic, requesterId);
          resolve(response);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(correlationId);
          this.unsubscribeFromReply(replyTopic, requesterId);
          reject(error);
        },
      };

      this.pendingRequests.set(correlationId, pendingRequest);

      // Subscribe to reply topic
      this.subscribe(requesterId, [replyTopic], (message) => {
        if (message.correlationId === correlationId) {
          pendingRequest.resolve(message);
        }
      });

      // Publish the request
      this.publish(topic, payload, requesterId, {
        correlationId,
        replyTo: replyTopic,
      });
    });
  }

  reply(originalMessage: Message, payload: unknown, replierId: string): Message | null {
    if (!originalMessage.replyTo || !originalMessage.correlationId) {
      return null;
    }

    return this.publish(originalMessage.replyTo, payload, replierId, {
      correlationId: originalMessage.correlationId,
    });
  }

  private unsubscribeFromReply(replyTopic: string, clientId: string): void {
    // Find and remove the subscriber for this reply topic
    for (const [subscriberId, subscriber] of this.subscribers.entries()) {
      if (subscriber.clientId === clientId && subscriber.topics.has(replyTopic)) {
        this.unsubscribe(subscriberId);
        break;
      }
    }
    // Clean up the reply topic
    this.topicManager.deleteTopic(replyTopic);
  }

  // ============================================
  // Message Acknowledgment
  // ============================================

  ack(subscriberId: string, messageId: string): boolean {
    return this.messageQueue.ack(subscriberId, messageId);
  }

  nack(subscriberId: string, messageId: string, reason: string): boolean {
    return this.messageQueue.nack(subscriberId, messageId, reason);
  }

  // ============================================
  // Event System
  // ============================================

  on(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: BrokerEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  // ============================================
  // Metrics & Stats
  // ============================================

  getMetrics(): BrokerMetrics {
    // Calculate messages per second (last minute)
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.messagesLastMinute = this.messagesLastMinute.filter((t) => t > oneMinuteAgo);
    const messagesPerSecond = this.messagesLastMinute.length / 60;

    const topicStats = this.topicManager.getStats();
    const queueMetrics = this.messageQueue.getMetrics();

    return {
      uptime: now - this.startTime,
      totalMessages: this.totalMessages,
      messagesPerSecond: Math.round(messagesPerSecond * 100) / 100,
      activeConnections: this.subscribers.size,
      totalTopics: topicStats.totalTopics,
      totalSubscribers: topicStats.totalSubscriptions,
      queuedMessages: queueMetrics.totalQueued,
      deadLetterCount: queueMetrics.deadLetterCount,
      memoryUsage: process.memoryUsage(),
    };
  }

  getSubscribers(): Subscriber[] {
    return Array.from(this.subscribers.values());
  }

  getSubscriber(id: string): Subscriber | undefined {
    return this.subscribers.get(id);
  }

  getPublishers(): Publisher[] {
    return Array.from(this.publishers.values());
  }

  getDeadLetterQueue() {
    return this.messageQueue.getDeadLetterQueue();
  }

  getMessageHistory(topic: string, limit?: number) {
    return this.topicManager.getMessageHistory(topic, limit);
  }

  retryDeadLetter(messageId: string): boolean {
    const dlq = this.messageQueue.getDeadLetterQueue();
    const item = dlq.find((m) => m.id === messageId);
    if (item && item.message) {
      this.routeMessage(item.message);
      this.messageQueue.removeFromDeadLetter(messageId);
      return true;
    }
    return false;
  }

  retryAllDeadLetters(): number {
    const dlq = this.messageQueue.getDeadLetterQueue();
    let count = 0;
    for (const item of dlq) {
      if (item.message) {
        this.routeMessage(item.message);
        this.messageQueue.removeFromDeadLetter(item.id);
        count++;
      }
    }
    return count;
  }

  deleteDeadLetter(messageId: string): boolean {
    return this.messageQueue.removeFromDeadLetter(messageId);
  }

  // ============================================
  // Private Helpers
  // ============================================

  private trackPublisher(publisherId: string, topic: string): void {
    let publisher = this.publishers.get(publisherId);

    if (!publisher) {
      publisher = {
        id: publisherId,
        clientId: publisherId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        publishedMessages: 0,
        topics: new Set(),
      };
      this.publishers.set(publisherId, publisher);
    }

    publisher.publishedMessages++;
    publisher.lastActivity = Date.now();
    publisher.topics.add(topic);
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private startCleanupInterval(): void {
    // Run cleanup every minute
    setInterval(() => {
      this.messageQueue.purgeExpired();
      this.topicManager.purgeOldMessages();
    }, 60000);
  }
}

// Singleton instance for the application
export const broker = new MessageBroker();
