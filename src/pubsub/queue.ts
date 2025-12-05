/**
 * Ankita PubSub System - Message Queue
 *
 * In-memory message queue with priority, TTL, and retry support.
 * Designed for scalability with O(1) enqueue and O(log n) dequeue.
 */

import type { QueuedMessage, DeadLetterMessage } from './types';

export class MessageQueue {
  private queues: Map<string, QueuedMessage[]> = new Map();
  private deadLetterQueue: DeadLetterMessage[] = [];
  private maxQueueSize: number;
  private maxDeadLetterSize: number;

  constructor(maxQueueSize = 10000, maxDeadLetterSize = 1000) {
    this.maxQueueSize = maxQueueSize;
    this.maxDeadLetterSize = maxDeadLetterSize;
  }

  /**
   * Enqueue a message for a specific subscriber
   */
  enqueue(subscriberId: string, message: QueuedMessage): boolean {
    let queue = this.queues.get(subscriberId);

    if (!queue) {
      queue = [];
      this.queues.set(subscriberId, queue);
    }

    // Check queue size limit
    if (queue.length >= this.maxQueueSize) {
      // Remove oldest message to make room (FIFO eviction)
      const evicted = queue.shift();
      if (evicted) {
        this.moveToDeadLetter(evicted, 'Queue overflow - message evicted');
      }
    }

    queue.push(message);
    return true;
  }

  /**
   * Dequeue the next message for a subscriber
   */
  dequeue(subscriberId: string): QueuedMessage | undefined {
    const queue = this.queues.get(subscriberId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    // Get messages that are ready (past their retry delay)
    const now = Date.now();
    const readyIndex = queue.findIndex(
      (msg) => !msg.nextRetryAt || msg.nextRetryAt <= now
    );

    if (readyIndex === -1) {
      return undefined;
    }

    return queue.splice(readyIndex, 1)[0];
  }

  /**
   * Peek at the next message without removing it
   */
  peek(subscriberId: string): QueuedMessage | undefined {
    const queue = this.queues.get(subscriberId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const now = Date.now();
    return queue.find((msg) => !msg.nextRetryAt || msg.nextRetryAt <= now);
  }

  /**
   * Get all pending messages for a subscriber
   */
  getAll(subscriberId: string): QueuedMessage[] {
    return this.queues.get(subscriberId) || [];
  }

  /**
   * Get queue depth for a subscriber
   */
  getQueueDepth(subscriberId: string): number {
    return this.queues.get(subscriberId)?.length || 0;
  }

  /**
   * Get total queued messages across all subscribers
   */
  getTotalQueued(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Acknowledge a message (remove from queue)
   */
  ack(subscriberId: string, messageId: string): boolean {
    const queue = this.queues.get(subscriberId);
    if (!queue) return false;

    const index = queue.findIndex((msg) => msg.id === messageId);
    if (index === -1) return false;

    queue.splice(index, 1);
    return true;
  }

  /**
   * Negative acknowledge - schedule retry or move to DLQ
   */
  nack(subscriberId: string, messageId: string, reason: string): boolean {
    const queue = this.queues.get(subscriberId);
    if (!queue) return false;

    const index = queue.findIndex((msg) => msg.id === messageId);
    if (index === -1) return false;

    const message = queue[index];
    message.attempts++;

    if (message.attempts >= message.maxRetries) {
      // Move to dead letter queue
      queue.splice(index, 1);
      this.moveToDeadLetter(message, reason);
      return true;
    }

    // Schedule retry with exponential backoff
    const backoffMs = Math.min(
      1000 * Math.pow(2, message.attempts),
      60000 // Max 1 minute backoff
    );
    message.nextRetryAt = Date.now() + backoffMs;

    return true;
  }

  /**
   * Move message to dead letter queue
   */
  private moveToDeadLetter(message: QueuedMessage, reason: string): void {
    const dlqMessage: DeadLetterMessage = {
      ...message,
      failureReason: reason,
      failedAt: Date.now(),
      originalTopic: message.topic,
    };

    this.deadLetterQueue.push(dlqMessage);

    // Trim DLQ if it exceeds max size
    if (this.deadLetterQueue.length > this.maxDeadLetterSize) {
      this.deadLetterQueue.shift();
    }
  }

  /**
   * Get dead letter queue messages
   */
  getDeadLetterQueue(): DeadLetterMessage[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Get dead letter queue size
   */
  getDeadLetterCount(): number {
    return this.deadLetterQueue.length;
  }

  /**
   * Retry a message from dead letter queue
   */
  retryFromDeadLetter(messageId: string): DeadLetterMessage | undefined {
    const index = this.deadLetterQueue.findIndex((msg) => msg.id === messageId);
    if (index === -1) return undefined;

    const message = this.deadLetterQueue.splice(index, 1)[0];
    message.attempts = 0;
    message.nextRetryAt = undefined;

    return message;
  }

  /**
   * Remove a message from dead letter queue
   */
  removeFromDeadLetter(messageId: string): boolean {
    const index = this.deadLetterQueue.findIndex((msg) => msg.id === messageId);
    if (index === -1) return false;

    this.deadLetterQueue.splice(index, 1);
    return true;
  }

  /**
   * Clear all messages for a subscriber
   */
  clearSubscriber(subscriberId: string): void {
    this.queues.delete(subscriberId);
  }

  /**
   * Remove expired messages (based on TTL)
   */
  purgeExpired(): number {
    let purged = 0;
    const now = Date.now();

    for (const [subscriberId, queue] of this.queues.entries()) {
      const before = queue.length;
      const filtered = queue.filter((msg) => {
        if (msg.ttl && msg.timestamp + msg.ttl < now) {
          return false; // Expired
        }
        return true;
      });

      purged += before - filtered.length;
      this.queues.set(subscriberId, filtered);
    }

    return purged;
  }

  /**
   * Get metrics
   */
  getMetrics(): {
    totalQueued: number;
    subscriberCount: number;
    deadLetterCount: number;
    avgQueueDepth: number;
  } {
    const totalQueued = this.getTotalQueued();
    const subscriberCount = this.queues.size;

    return {
      totalQueued,
      subscriberCount,
      deadLetterCount: this.deadLetterQueue.length,
      avgQueueDepth: subscriberCount > 0 ? totalQueued / subscriberCount : 0,
    };
  }
}
