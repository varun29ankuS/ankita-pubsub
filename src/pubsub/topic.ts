/**
 * Ankita PubSub System - Topic Manager
 *
 * Manages topics, message history, and subscriber routing.
 */

import type {
  Topic,
  TopicConfig,
  Message,
  Subscriber,
  DEFAULT_TOPIC_CONFIG,
} from './types';

export class TopicManager {
  private topics: Map<string, Topic> = new Map();
  private messageHistory: Map<string, Message[]> = new Map();
  private topicSubscribers: Map<string, Set<string>> = new Map();

  /**
   * Create a new topic
   */
  createTopic(
    name: string,
    createdBy: string,
    config: Partial<TopicConfig> = {}
  ): Topic {
    if (this.topics.has(name)) {
      throw new Error(`Topic '${name}' already exists`);
    }

    // Validate topic name (alphanumeric, dots, hyphens, underscores, and wildcards # *)
    if (!/^[a-zA-Z0-9._#*-]+$/.test(name)) {
      throw new Error(
        'Topic name must contain only alphanumeric characters, dots, hyphens, underscores, and wildcards'
      );
    }

    const defaultConfig: TopicConfig = {
      maxQueueSize: 1000,
      messageRetention: 3600000,
      maxRetries: 3,
      retryDelay: 5000,
      requireAck: false,
    };

    const topic: Topic = {
      name,
      createdAt: Date.now(),
      createdBy,
      messageCount: 0,
      subscriberCount: 0,
      config: { ...defaultConfig, ...config },
    };

    this.topics.set(name, topic);
    this.messageHistory.set(name, []);
    this.topicSubscribers.set(name, new Set());

    return topic;
  }

  /**
   * Delete a topic
   */
  deleteTopic(name: string): boolean {
    if (!this.topics.has(name)) {
      return false;
    }

    this.topics.delete(name);
    this.messageHistory.delete(name);
    this.topicSubscribers.delete(name);

    return true;
  }

  /**
   * Get a topic by name
   */
  getTopic(name: string): Topic | undefined {
    return this.topics.get(name);
  }

  /**
   * Get all topics
   */
  getAllTopics(): Topic[] {
    return Array.from(this.topics.values());
  }

  /**
   * Check if topic exists
   */
  hasTopic(name: string): boolean {
    return this.topics.has(name);
  }

  /**
   * Add a subscriber to a topic
   */
  addSubscriber(topicName: string, subscriberId: string): boolean {
    const subscribers = this.topicSubscribers.get(topicName);
    if (!subscribers) {
      return false;
    }

    if (subscribers.has(subscriberId)) {
      return true; // Already subscribed
    }

    subscribers.add(subscriberId);

    // Update topic subscriber count
    const topic = this.topics.get(topicName);
    if (topic) {
      topic.subscriberCount = subscribers.size;
    }

    return true;
  }

  /**
   * Remove a subscriber from a topic
   */
  removeSubscriber(topicName: string, subscriberId: string): boolean {
    const subscribers = this.topicSubscribers.get(topicName);
    if (!subscribers) {
      return false;
    }

    const removed = subscribers.delete(subscriberId);

    if (removed) {
      const topic = this.topics.get(topicName);
      if (topic) {
        topic.subscriberCount = subscribers.size;
      }
    }

    return removed;
  }

  /**
   * Remove subscriber from all topics
   */
  removeSubscriberFromAll(subscriberId: string): string[] {
    const removedFrom: string[] = [];

    for (const [topicName, subscribers] of this.topicSubscribers.entries()) {
      if (subscribers.delete(subscriberId)) {
        removedFrom.push(topicName);

        const topic = this.topics.get(topicName);
        if (topic) {
          topic.subscriberCount = subscribers.size;
        }
      }
    }

    return removedFrom;
  }

  /**
   * Get subscribers for a topic
   */
  getSubscribers(topicName: string): string[] {
    const subscribers = this.topicSubscribers.get(topicName);
    return subscribers ? Array.from(subscribers) : [];
  }

  /**
   * Record a message in topic history
   */
  recordMessage(message: Message): void {
    const topic = this.topics.get(message.topic);
    if (!topic) {
      return;
    }

    topic.messageCount++;

    // Add to history
    let history = this.messageHistory.get(message.topic);
    if (!history) {
      history = [];
      this.messageHistory.set(message.topic, history);
    }

    history.push(message);

    // Trim history based on retention
    const retention = topic.config.messageRetention;
    const cutoff = Date.now() - retention;

    while (history.length > 0 && history[0].timestamp < cutoff) {
      history.shift();
    }

    // Also limit to a max number of messages
    const maxHistory = 1000;
    while (history.length > maxHistory) {
      history.shift();
    }
  }

  /**
   * Get message history for a topic
   */
  getMessageHistory(topicName: string, limit = 100): Message[] {
    const history = this.messageHistory.get(topicName);
    if (!history) {
      return [];
    }

    return history.slice(-limit);
  }

  /**
   * Get topics matching a pattern (supports wildcards)
   * e.g., "orders.*" matches "orders.created", "orders.updated"
   */
  matchTopics(pattern: string): string[] {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^.]+')
      .replace(/\#/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);

    return Array.from(this.topics.keys()).filter((name) => regex.test(name));
  }

  /**
   * Get topic statistics
   */
  getStats(): {
    totalTopics: number;
    totalSubscriptions: number;
    totalMessages: number;
    topTopics: { name: string; messageCount: number; subscriberCount: number }[];
  } {
    let totalSubscriptions = 0;
    let totalMessages = 0;
    const topTopics: { name: string; messageCount: number; subscriberCount: number }[] = [];

    for (const topic of this.topics.values()) {
      totalSubscriptions += topic.subscriberCount;
      totalMessages += topic.messageCount;
      topTopics.push({
        name: topic.name,
        messageCount: topic.messageCount,
        subscriberCount: topic.subscriberCount,
      });
    }

    // Sort by message count
    topTopics.sort((a, b) => b.messageCount - a.messageCount);

    return {
      totalTopics: this.topics.size,
      totalSubscriptions,
      totalMessages,
      topTopics: topTopics.slice(0, 10),
    };
  }

  /**
   * Purge old messages from all topics
   */
  purgeOldMessages(): number {
    let purged = 0;
    const now = Date.now();

    for (const [topicName, history] of this.messageHistory.entries()) {
      const topic = this.topics.get(topicName);
      if (!topic) continue;

      const cutoff = now - topic.config.messageRetention;
      const before = history.length;

      while (history.length > 0 && history[0].timestamp < cutoff) {
        history.shift();
        purged++;
      }
    }

    return purged;
  }
}
