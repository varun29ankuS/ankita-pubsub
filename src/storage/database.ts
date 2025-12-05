/**
 * Ankita PubSub System - SQLite Database Layer
 *
 * Provides persistence for messages, topics, subscriptions, and metrics.
 * Uses Bun's built-in SQLite for high performance.
 */

import { Database } from 'bun:sqlite';
import type { Message, Topic, TopicConfig, Subscriber, ApiKey, Permission } from '../pubsub/types';

export class PubSubDatabase {
  private db: Database;

  constructor(dbPath: string = 'pubsub.db') {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    // Enable WAL mode for better concurrent performance
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');

    // Create tables
    this.db.run(`
      CREATE TABLE IF NOT EXISTS topics (
        name TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        subscriber_count INTEGER DEFAULT 0,
        config TEXT NOT NULL,
        description TEXT,
        tags TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        payload TEXT NOT NULL,
        headers TEXT,
        publisher_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        ttl INTEGER,
        correlation_id TEXT,
        reply_to TEXT,
        size_bytes INTEGER,
        FOREIGN KEY (topic) REFERENCES topics(name)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        consumer_group TEXT,
        created_at INTEGER NOT NULL,
        last_activity INTEGER,
        filter TEXT,
        offset_position INTEGER DEFAULT 0,
        FOREIGN KEY (topic) REFERENCES topics(name)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_topic ON subscriptions(topic)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_consumer_group ON subscriptions(consumer_group)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS consumer_groups (
        name TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        strategy TEXT DEFAULT 'round-robin',
        current_offset INTEGER DEFAULT 0,
        committed_offset INTEGER DEFAULT 0,
        FOREIGN KEY (topic) REFERENCES topics(name)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id TEXT PRIMARY KEY,
        original_message_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        payload TEXT NOT NULL,
        failure_reason TEXT NOT NULL,
        failed_at INTEGER NOT NULL,
        attempts INTEGER DEFAULT 0,
        subscriber_id TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY,
        client_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        permissions TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        rate_limit_max INTEGER DEFAULT 1000,
        rate_limit_window INTEGER DEFAULT 60000,
        is_active INTEGER DEFAULT 1,
        last_used INTEGER,
        description TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS metrics_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        total_messages INTEGER,
        messages_per_second REAL,
        active_connections INTEGER,
        total_topics INTEGER,
        queued_messages INTEGER,
        dead_letter_count INTEGER,
        memory_usage INTEGER,
        cpu_usage REAL
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics_snapshots(timestamp DESC)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        client_id TEXT,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        ip_address TEXT
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC)
    `);
  }

  // ============================================
  // Topic Operations
  // ============================================

  saveTopic(topic: Topic): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO topics (name, created_at, created_by, message_count, subscriber_count, config, description, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      topic.name,
      topic.createdAt,
      topic.createdBy,
      topic.messageCount,
      topic.subscriberCount,
      JSON.stringify(topic.config),
      (topic as any).description || null,
      (topic as any).tags ? JSON.stringify((topic as any).tags) : null
    );
  }

  getTopic(name: string): Topic | null {
    const stmt = this.db.prepare('SELECT * FROM topics WHERE name = ?');
    const row = stmt.get(name) as any;

    if (!row) return null;

    return {
      name: row.name,
      createdAt: row.created_at,
      createdBy: row.created_by,
      messageCount: row.message_count,
      subscriberCount: row.subscriber_count,
      config: JSON.parse(row.config),
    };
  }

  getAllTopics(): Topic[] {
    const stmt = this.db.prepare('SELECT * FROM topics ORDER BY message_count DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      name: row.name,
      createdAt: row.created_at,
      createdBy: row.created_by,
      messageCount: row.message_count,
      subscriberCount: row.subscriber_count,
      config: JSON.parse(row.config),
    }));
  }

  deleteTopic(name: string): boolean {
    const stmt = this.db.prepare('DELETE FROM topics WHERE name = ?');
    const result = stmt.run(name);
    return result.changes > 0;
  }

  updateTopicStats(name: string, messageCount: number, subscriberCount: number): void {
    const stmt = this.db.prepare(`
      UPDATE topics SET message_count = ?, subscriber_count = ? WHERE name = ?
    `);
    stmt.run(messageCount, subscriberCount, name);
  }

  // ============================================
  // Message Operations
  // ============================================

  saveMessage(message: Message): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, topic, payload, headers, publisher_id, timestamp, ttl, correlation_id, reply_to, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const payloadStr = JSON.stringify(message.payload);
    stmt.run(
      message.id,
      message.topic,
      payloadStr,
      message.headers ? JSON.stringify(message.headers) : null,
      message.publisherId,
      message.timestamp,
      message.ttl || null,
      message.correlationId || null,
      message.replyTo || null,
      Buffer.byteLength(payloadStr, 'utf8')
    );

    // Update topic message count
    this.db.run('UPDATE topics SET message_count = message_count + 1 WHERE name = ?', [message.topic]);
  }

  getMessages(topic: string, limit: number = 100, offset: number = 0): Message[] {
    const stmt = this.db.prepare(`
      SELECT * FROM messages WHERE topic = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(topic, limit, offset) as any[];

    return rows.map(row => ({
      id: row.id,
      topic: row.topic,
      payload: JSON.parse(row.payload),
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      publisherId: row.publisher_id,
      timestamp: row.timestamp,
      ttl: row.ttl || undefined,
      correlationId: row.correlation_id || undefined,
      replyTo: row.reply_to || undefined,
    }));
  }

  getRecentMessages(limit: number = 100): Message[] {
    const stmt = this.db.prepare(`
      SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];

    return rows.map(row => ({
      id: row.id,
      topic: row.topic,
      payload: JSON.parse(row.payload),
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      publisherId: row.publisher_id,
      timestamp: row.timestamp,
      ttl: row.ttl || undefined,
      correlationId: row.correlation_id || undefined,
      replyTo: row.reply_to || undefined,
    }));
  }

  getMessage(id: string): Message | null {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      topic: row.topic,
      payload: JSON.parse(row.payload),
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      publisherId: row.publisher_id,
      timestamp: row.timestamp,
      ttl: row.ttl || undefined,
      correlationId: row.correlation_id || undefined,
      replyTo: row.reply_to || undefined,
    };
  }

  searchMessages(query: string, limit: number = 50): Message[] {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE payload LIKE ? OR topic LIKE ? OR publisher_id LIKE ?
      ORDER BY timestamp DESC LIMIT ?
    `);
    const pattern = `%${query}%`;
    const rows = stmt.all(pattern, pattern, pattern, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      topic: row.topic,
      payload: JSON.parse(row.payload),
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      publisherId: row.publisher_id,
      timestamp: row.timestamp,
    }));
  }

  deleteOldMessages(retentionMs: number): number {
    const cutoff = Date.now() - retentionMs;
    const stmt = this.db.prepare('DELETE FROM messages WHERE timestamp < ?');
    const result = stmt.run(cutoff);
    return result.changes;
  }

  getMessageCount(topic?: string): number {
    if (topic) {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE topic = ?');
      const row = stmt.get(topic) as any;
      return row.count;
    }
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
    const row = stmt.get() as any;
    return row.count;
  }

  // ============================================
  // Consumer Group Operations
  // ============================================

  createConsumerGroup(name: string, topic: string, strategy: string = 'round-robin'): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO consumer_groups (name, topic, created_at, strategy, current_offset, committed_offset)
      VALUES (?, ?, ?, ?, 0, 0)
    `);
    stmt.run(name, topic, Date.now(), strategy);
  }

  getConsumerGroup(name: string): any | null {
    const stmt = this.db.prepare('SELECT * FROM consumer_groups WHERE name = ?');
    return stmt.get(name);
  }

  getAllConsumerGroups(): any[] {
    const stmt = this.db.prepare('SELECT * FROM consumer_groups');
    return stmt.all() as any[];
  }

  updateConsumerGroupOffset(name: string, offset: number): void {
    const stmt = this.db.prepare('UPDATE consumer_groups SET current_offset = ? WHERE name = ?');
    stmt.run(offset, name);
  }

  commitConsumerGroupOffset(name: string, offset: number): void {
    const stmt = this.db.prepare('UPDATE consumer_groups SET committed_offset = ? WHERE name = ?');
    stmt.run(offset, name);
  }

  // ============================================
  // Dead Letter Queue Operations
  // ============================================

  addToDeadLetterQueue(
    messageId: string,
    topic: string,
    payload: unknown,
    reason: string,
    subscriberId?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO dead_letter_queue (id, original_message_id, topic, payload, failure_reason, failed_at, subscriber_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      `dlq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      messageId,
      topic,
      JSON.stringify(payload),
      reason,
      Date.now(),
      subscriberId || null
    );
  }

  getDeadLetterQueue(limit: number = 100): any[] {
    const stmt = this.db.prepare('SELECT * FROM dead_letter_queue ORDER BY failed_at DESC LIMIT ?');
    return stmt.all(limit) as any[];
  }

  retryFromDeadLetterQueue(id: string): any | null {
    const stmt = this.db.prepare('SELECT * FROM dead_letter_queue WHERE id = ?');
    const row = stmt.get(id);
    if (row) {
      this.db.run('DELETE FROM dead_letter_queue WHERE id = ?', [id]);
    }
    return row;
  }

  getDeadLetterCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue');
    const row = stmt.get() as any;
    return row.count;
  }

  // ============================================
  // API Key Operations
  // ============================================

  saveApiKey(apiKey: ApiKey): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO api_keys (key, client_id, name, permissions, created_at, expires_at, rate_limit_max, rate_limit_window, is_active, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      apiKey.key,
      apiKey.clientId,
      apiKey.name,
      JSON.stringify(apiKey.permissions),
      apiKey.createdAt,
      apiKey.expiresAt || null,
      apiKey.rateLimit.maxRequests,
      apiKey.rateLimit.windowMs,
      apiKey.isActive ? 1 : 0,
      (apiKey as any).description || null
    );
  }

  getApiKey(key: string): ApiKey | null {
    const stmt = this.db.prepare('SELECT * FROM api_keys WHERE key = ?');
    const row = stmt.get(key) as any;

    if (!row) return null;

    return {
      key: row.key,
      clientId: row.client_id,
      name: row.name,
      permissions: JSON.parse(row.permissions),
      createdAt: row.created_at,
      expiresAt: row.expires_at || undefined,
      rateLimit: {
        maxRequests: row.rate_limit_max,
        windowMs: row.rate_limit_window,
        currentRequests: 0,
        windowStart: Date.now(),
      },
      isActive: row.is_active === 1,
    };
  }

  getAllApiKeys(): ApiKey[] {
    const stmt = this.db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      key: row.key,
      clientId: row.client_id,
      name: row.name,
      permissions: JSON.parse(row.permissions),
      createdAt: row.created_at,
      expiresAt: row.expires_at || undefined,
      rateLimit: {
        maxRequests: row.rate_limit_max,
        windowMs: row.rate_limit_window,
        currentRequests: 0,
        windowStart: Date.now(),
      },
      isActive: row.is_active === 1,
    }));
  }

  updateApiKeyLastUsed(key: string): void {
    const stmt = this.db.prepare('UPDATE api_keys SET last_used = ? WHERE key = ?');
    stmt.run(Date.now(), key);
  }

  // ============================================
  // Metrics Operations
  // ============================================

  saveMetricsSnapshot(metrics: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO metrics_snapshots (timestamp, total_messages, messages_per_second, active_connections, total_topics, queued_messages, dead_letter_count, memory_usage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      Date.now(),
      metrics.totalMessages,
      metrics.messagesPerSecond,
      metrics.activeConnections,
      metrics.totalTopics,
      metrics.queuedMessages,
      metrics.deadLetterCount,
      metrics.memoryUsage?.heapUsed || 0
    );
  }

  getMetricsHistory(hours: number = 24): any[] {
    const since = Date.now() - (hours * 60 * 60 * 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM metrics_snapshots WHERE timestamp > ? ORDER BY timestamp ASC
    `);
    return stmt.all(since) as any[];
  }

  // ============================================
  // Audit Log Operations
  // ============================================

  logAudit(action: string, clientId: string | null, resourceType: string, resourceId: string, details?: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (timestamp, action, client_id, resource_type, resource_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      Date.now(),
      action,
      clientId,
      resourceType,
      resourceId,
      details ? JSON.stringify(details) : null
    );
  }

  getAuditLog(limit: number = 100, filters?: { action?: string; clientId?: string }): any[] {
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];

    if (filters?.action) {
      query += ' AND action = ?';
      params.push(filters.action);
    }
    if (filters?.clientId) {
      query += ' AND client_id = ?';
      params.push(filters.clientId);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as any[];
  }

  // ============================================
  // Statistics
  // ============================================

  getStats(): any {
    const topicsCount = (this.db.prepare('SELECT COUNT(*) as count FROM topics').get() as any).count;
    const messagesCount = (this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as any).count;
    const dlqCount = (this.db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue').get() as any).count;
    const apiKeysCount = (this.db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1').get() as any).count;
    const consumerGroupsCount = (this.db.prepare('SELECT COUNT(*) as count FROM consumer_groups').get() as any).count;

    // Messages per topic
    const messagesPerTopic = this.db.prepare(`
      SELECT topic, COUNT(*) as count FROM messages GROUP BY topic ORDER BY count DESC LIMIT 10
    `).all();

    // Messages over time (last 24 hours, hourly)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const messagesOverTime = this.db.prepare(`
      SELECT
        (timestamp / 3600000) * 3600000 as hour,
        COUNT(*) as count
      FROM messages
      WHERE timestamp > ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(oneDayAgo);

    return {
      topicsCount,
      messagesCount,
      dlqCount,
      apiKeysCount,
      consumerGroupsCount,
      messagesPerTopic,
      messagesOverTime,
    };
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
export const database = new PubSubDatabase();
