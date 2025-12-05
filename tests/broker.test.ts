/**
 * Ankita PubSub - Broker Tests
 *
 * Unit tests for the message broker core functionality.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MessageBroker } from '../src/pubsub/broker';

describe('MessageBroker', () => {
  let broker: MessageBroker;

  beforeEach(() => {
    broker = new MessageBroker();
  });

  describe('Topic Management', () => {
    test('should create a topic', () => {
      const topic = broker.createTopic('test.topic', 'test-user');

      expect(topic).toBeDefined();
      expect(topic.name).toBe('test.topic');
      expect(topic.createdBy).toBe('test-user');
      expect(topic.messageCount).toBe(0);
      expect(topic.subscriberCount).toBe(0);
    });

    test('should throw when creating duplicate topic', () => {
      broker.createTopic('test.topic', 'test-user');

      expect(() => {
        broker.createTopic('test.topic', 'test-user');
      }).toThrow("Topic 'test.topic' already exists");
    });

    test('should delete a topic', () => {
      broker.createTopic('test.topic', 'test-user');
      const deleted = broker.deleteTopic('test.topic');

      expect(deleted).toBe(true);
      expect(broker.getTopic('test.topic')).toBeUndefined();
    });

    test('should return false when deleting non-existent topic', () => {
      const deleted = broker.deleteTopic('non-existent');
      expect(deleted).toBe(false);
    });

    test('should get all topics', () => {
      broker.createTopic('topic1', 'user1');
      broker.createTopic('topic2', 'user2');

      const topics = broker.getAllTopics();

      expect(topics.length).toBe(2);
      expect(topics.map((t) => t.name)).toContain('topic1');
      expect(topics.map((t) => t.name)).toContain('topic2');
    });
  });

  describe('Publishing', () => {
    test('should publish a message', () => {
      const message = broker.publish('test.topic', { data: 'test' }, 'publisher-1');

      expect(message).toBeDefined();
      expect(message.id).toBeDefined();
      expect(message.topic).toBe('test.topic');
      expect(message.payload).toEqual({ data: 'test' });
      expect(message.publisherId).toBe('publisher-1');
    });

    test('should auto-create topic when publishing', () => {
      broker.publish('auto.created', { data: 'test' }, 'publisher-1');

      const topic = broker.getTopic('auto.created');
      expect(topic).toBeDefined();
      expect(topic!.name).toBe('auto.created');
    });

    test('should include headers in message', () => {
      const message = broker.publish('test.topic', { data: 'test' }, 'publisher-1', {
        headers: { 'x-custom': 'value' },
      });

      expect(message.headers).toEqual({ 'x-custom': 'value' });
    });

    test('should include correlationId and replyTo', () => {
      const message = broker.publish('test.topic', { data: 'test' }, 'publisher-1', {
        correlationId: 'corr-123',
        replyTo: 'reply.topic',
      });

      expect(message.correlationId).toBe('corr-123');
      expect(message.replyTo).toBe('reply.topic');
    });
  });

  describe('Subscribing', () => {
    test('should create a subscriber', () => {
      const messages: unknown[] = [];
      const subscriber = broker.subscribe('client-1', ['test.topic'], (msg) => {
        messages.push(msg);
      });

      expect(subscriber).toBeDefined();
      expect(subscriber.clientId).toBe('client-1');
      expect(subscriber.topics.has('test.topic')).toBe(true);
      expect(subscriber.isOnline).toBe(true);
    });

    test('should deliver messages to subscribers', () => {
      const messages: unknown[] = [];
      broker.subscribe('client-1', ['test.topic'], (msg) => {
        messages.push(msg);
      });

      broker.publish('test.topic', { data: 'hello' }, 'publisher-1');

      expect(messages.length).toBe(1);
      expect((messages[0] as { payload: { data: string } }).payload).toEqual({ data: 'hello' });
    });

    test('should deliver messages to multiple subscribers', () => {
      const messages1: unknown[] = [];
      const messages2: unknown[] = [];

      broker.subscribe('client-1', ['test.topic'], (msg) => {
        messages1.push(msg);
      });

      broker.subscribe('client-2', ['test.topic'], (msg) => {
        messages2.push(msg);
      });

      broker.publish('test.topic', { data: 'hello' }, 'publisher-1');

      expect(messages1.length).toBe(1);
      expect(messages2.length).toBe(1);
    });

    test('should unsubscribe from topics', () => {
      const messages: unknown[] = [];
      const subscriber = broker.subscribe('client-1', ['test.topic'], (msg) => {
        messages.push(msg);
      });

      broker.unsubscribe(subscriber.id);
      broker.publish('test.topic', { data: 'hello' }, 'publisher-1');

      expect(messages.length).toBe(0);
    });

    test('should support wildcard subscriptions', () => {
      const messages: unknown[] = [];
      broker.subscribe('client-1', ['#'], (msg) => {
        messages.push(msg);
      });

      broker.publish('any.topic', { data: 'hello' }, 'publisher-1');
      broker.publish('another.topic', { data: 'world' }, 'publisher-1');

      expect(messages.length).toBe(2);
    });
  });

  describe('Metrics', () => {
    test('should track message count', () => {
      broker.publish('test.topic', { data: '1' }, 'publisher-1');
      broker.publish('test.topic', { data: '2' }, 'publisher-1');
      broker.publish('test.topic', { data: '3' }, 'publisher-1');

      const metrics = broker.getMetrics();

      expect(metrics.totalMessages).toBe(3);
    });

    test('should track active connections', () => {
      broker.subscribe('client-1', ['topic1'], () => {});
      broker.subscribe('client-2', ['topic2'], () => {});

      const metrics = broker.getMetrics();

      expect(metrics.activeConnections).toBe(2);
    });

    test('should track topic count', () => {
      broker.createTopic('topic1', 'user1');
      broker.createTopic('topic2', 'user2');

      const metrics = broker.getMetrics();

      expect(metrics.totalTopics).toBe(2);
    });
  });

  describe('Message History', () => {
    test('should store message history', () => {
      broker.publish('test.topic', { data: '1' }, 'publisher-1');
      broker.publish('test.topic', { data: '2' }, 'publisher-1');

      const history = broker.getMessageHistory('test.topic');

      expect(history.length).toBe(2);
    });

    test('should limit history size', () => {
      for (let i = 0; i < 150; i++) {
        broker.publish('test.topic', { index: i }, 'publisher-1');
      }

      const history = broker.getMessageHistory('test.topic', 50);

      expect(history.length).toBe(50);
    });
  });
});
