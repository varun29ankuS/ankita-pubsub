/**
 * Ankita PubSub - Audit Logging System
 *
 * Security audit logging for compliance and monitoring:
 * - Authentication events (success/failure)
 * - Authorization decisions
 * - Configuration changes
 * - Admin actions
 * - Security-sensitive operations
 */

import { logger } from '../logging';

export type AuditEventType =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.token.issued'
  | 'auth.token.revoked'
  | 'auth.apikey.created'
  | 'auth.apikey.deleted'
  | 'auth.apikey.rotated'
  | 'auth.rate_limit.exceeded'
  | 'authz.access.granted'
  | 'authz.access.denied'
  | 'config.changed'
  | 'admin.topic.created'
  | 'admin.topic.deleted'
  | 'admin.dlq.retry'
  | 'admin.dlq.purge'
  | 'admin.consumer_group.created'
  | 'admin.consumer_group.deleted'
  | 'security.suspicious_activity'
  | 'security.connection.rejected'
  | 'data.message.published'
  | 'data.message.delivered'
  | 'data.message.failed';

export interface AuditEvent {
  timestamp: string;
  eventType: AuditEventType;
  actor: {
    clientId?: string;
    ip?: string;
    userAgent?: string;
  };
  resource?: {
    type: string;
    id?: string;
    name?: string;
  };
  action: string;
  outcome: 'success' | 'failure';
  details?: Record<string, unknown>;
  correlationId?: string;
}

class AuditLogger {
  private events: AuditEvent[] = [];
  private maxEvents: number = 10000;

  /**
   * Log an audit event
   */
  log(event: Omit<AuditEvent, 'timestamp'>): void {
    const auditEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    // Store in memory (in production, send to SIEM/audit storage)
    this.events.push(auditEvent);

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log to structured logger
    const logContext = {
      eventType: event.eventType,
      actor: event.actor.clientId,
      resource: event.resource?.name || event.resource?.id,
      outcome: event.outcome,
      correlationId: event.correlationId,
      ...event.details,
    };

    if (event.outcome === 'failure' || event.eventType.startsWith('security.')) {
      logger.warn(`AUDIT: ${event.action}`, logContext);
    } else {
      logger.info(`AUDIT: ${event.action}`, logContext);
    }
  }

  /**
   * Log authentication success
   */
  authSuccess(clientId: string, ip?: string, details?: Record<string, unknown>): void {
    this.log({
      eventType: 'auth.login.success',
      actor: { clientId, ip },
      action: 'Authentication successful',
      outcome: 'success',
      details,
    });
  }

  /**
   * Log authentication failure
   */
  authFailure(reason: string, ip?: string, details?: Record<string, unknown>): void {
    this.log({
      eventType: 'auth.login.failure',
      actor: { ip },
      action: `Authentication failed: ${reason}`,
      outcome: 'failure',
      details: { reason, ...details },
    });
  }

  /**
   * Log rate limit exceeded
   */
  rateLimitExceeded(clientId: string, ip?: string): void {
    this.log({
      eventType: 'auth.rate_limit.exceeded',
      actor: { clientId, ip },
      action: 'Rate limit exceeded',
      outcome: 'failure',
      details: { clientId },
    });
  }

  /**
   * Log access denied
   */
  accessDenied(clientId: string, resource: string, action: string, reason: string): void {
    this.log({
      eventType: 'authz.access.denied',
      actor: { clientId },
      resource: { type: 'permission', name: resource },
      action: `Access denied: ${action}`,
      outcome: 'failure',
      details: { reason },
    });
  }

  /**
   * Log topic creation
   */
  topicCreated(clientId: string, topicName: string): void {
    this.log({
      eventType: 'admin.topic.created',
      actor: { clientId },
      resource: { type: 'topic', name: topicName },
      action: `Topic created: ${topicName}`,
      outcome: 'success',
    });
  }

  /**
   * Log topic deletion
   */
  topicDeleted(clientId: string, topicName: string): void {
    this.log({
      eventType: 'admin.topic.deleted',
      actor: { clientId },
      resource: { type: 'topic', name: topicName },
      action: `Topic deleted: ${topicName}`,
      outcome: 'success',
    });
  }

  /**
   * Log API key creation
   */
  apiKeyCreated(creatorId: string, keyName: string): void {
    this.log({
      eventType: 'auth.apikey.created',
      actor: { clientId: creatorId },
      resource: { type: 'apikey', name: keyName },
      action: `API key created: ${keyName}`,
      outcome: 'success',
    });
  }

  /**
   * Log suspicious activity
   */
  suspiciousActivity(description: string, details: Record<string, unknown>): void {
    this.log({
      eventType: 'security.suspicious_activity',
      actor: {},
      action: `Suspicious activity: ${description}`,
      outcome: 'failure',
      details,
    });
  }

  /**
   * Log connection rejection
   */
  connectionRejected(ip: string, reason: string): void {
    this.log({
      eventType: 'security.connection.rejected',
      actor: { ip },
      action: `Connection rejected: ${reason}`,
      outcome: 'failure',
      details: { reason },
    });
  }

  /**
   * Get recent audit events
   */
  getEvents(limit: number = 100, filter?: Partial<AuditEvent>): AuditEvent[] {
    let filtered = this.events;

    if (filter) {
      if (filter.eventType) {
        filtered = filtered.filter((e) => e.eventType === filter.eventType);
      }
      if (filter.actor?.clientId) {
        filtered = filtered.filter((e) => e.actor.clientId === filter.actor!.clientId);
      }
      if (filter.outcome) {
        filtered = filtered.filter((e) => e.outcome === filter.outcome);
      }
    }

    return filtered.slice(-limit);
  }

  /**
   * Get audit statistics
   */
  getStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    failureCount: number;
    securityEvents: number;
  } {
    const eventsByType: Record<string, number> = {};
    let failureCount = 0;
    let securityEvents = 0;

    for (const event of this.events) {
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
      if (event.outcome === 'failure') failureCount++;
      if (event.eventType.startsWith('security.')) securityEvents++;
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      failureCount,
      securityEvents,
    };
  }

  /**
   * Clear all events (for testing)
   */
  clear(): void {
    this.events = [];
  }
}

// Singleton instance
export const audit = new AuditLogger();
