/**
 * Ankita PubSub - Health Check System
 *
 * Kubernetes-compatible health checks:
 * - Liveness: Is the process running and responsive?
 * - Readiness: Is the service ready to accept traffic?
 */

import { broker } from '../pubsub/broker';
import { database } from '../storage/database';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  duration?: number;
}

class HealthChecker {
  private startTime: number = Date.now();
  private isReady: boolean = false;
  private checks: Map<string, () => Promise<HealthCheck>> = new Map();

  constructor() {
    this.registerDefaultChecks();
  }

  /**
   * Register default health checks
   */
  private registerDefaultChecks(): void {
    // Database connectivity check
    this.register('database', async () => {
      const start = performance.now();
      try {
        // Use stats to verify database is working
        const stats = database.getStats();
        return {
          name: 'database',
          status: 'pass',
          message: `SQLite OK: ${stats.messagesCount} messages, ${stats.topicsCount} topics`,
          duration: Math.round(performance.now() - start),
        };
      } catch (error) {
        return {
          name: 'database',
          status: 'fail',
          message: error instanceof Error ? error.message : 'Database check failed',
          duration: Math.round(performance.now() - start),
        };
      }
    });

    // Memory check
    this.register('memory', async () => {
      const start = performance.now();
      const memory = process.memoryUsage();
      const heapUsedMB = Math.round(memory.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memory.heapTotal / 1024 / 1024);
      const usagePercent = (memory.heapUsed / memory.heapTotal) * 100;

      let status: 'pass' | 'warn' | 'fail' = 'pass';
      if (usagePercent > 90) status = 'fail';
      else if (usagePercent > 75) status = 'warn';

      return {
        name: 'memory',
        status,
        message: `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB (${Math.round(usagePercent)}%)`,
        duration: Math.round(performance.now() - start),
      };
    });

    // Broker check
    this.register('broker', async () => {
      const start = performance.now();
      try {
        const metrics = broker.getMetrics();
        return {
          name: 'broker',
          status: 'pass',
          message: `${metrics.activeConnections} connections, ${metrics.totalTopics} topics`,
          duration: Math.round(performance.now() - start),
        };
      } catch (error) {
        return {
          name: 'broker',
          status: 'fail',
          message: error instanceof Error ? error.message : 'Broker check failed',
          duration: Math.round(performance.now() - start),
        };
      }
    });

    // Dead letter queue check
    this.register('dlq', async () => {
      const start = performance.now();
      const metrics = broker.getMetrics();
      const dlqSize = metrics.deadLetterCount;

      let status: 'pass' | 'warn' | 'fail' = 'pass';
      if (dlqSize > 100) status = 'warn';
      if (dlqSize > 500) status = 'fail';

      return {
        name: 'dlq',
        status,
        message: `${dlqSize} messages in dead letter queue`,
        duration: Math.round(performance.now() - start),
      };
    });
  }

  /**
   * Register a custom health check
   */
  register(name: string, check: () => Promise<HealthCheck>): void {
    this.checks.set(name, check);
  }

  /**
   * Mark the service as ready
   */
  setReady(ready: boolean): void {
    this.isReady = ready;
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Liveness check - is the process responsive?
   * This should be a lightweight check
   */
  async liveness(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      checks: [
        {
          name: 'process',
          status: 'pass',
          message: 'Process is running',
        },
      ],
    };
  }

  /**
   * Readiness check - is the service ready to accept traffic?
   * This runs all registered health checks
   */
  async readiness(): Promise<HealthStatus> {
    if (!this.isReady) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: this.getUptime(),
        checks: [
          {
            name: 'startup',
            status: 'fail',
            message: 'Service is still starting up',
          },
        ],
      };
    }

    const results: HealthCheck[] = [];
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    for (const [name, checkFn] of this.checks) {
      try {
        const result = await checkFn();
        results.push(result);

        if (result.status === 'fail') {
          overallStatus = 'unhealthy';
        } else if (result.status === 'warn' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      } catch (error) {
        results.push({
          name,
          status: 'fail',
          message: error instanceof Error ? error.message : 'Check failed',
        });
        overallStatus = 'unhealthy';
      }
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      checks: results,
    };
  }

  /**
   * Full health check with detailed info
   */
  async detailed(): Promise<HealthStatus & { version: string; environment: string }> {
    const readiness = await this.readiness();
    return {
      ...readiness,
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    };
  }
}

// Singleton instance
export const health = new HealthChecker();

/**
 * Format health status as HTTP response
 */
export function healthResponse(status: HealthStatus): Response {
  const httpStatus =
    status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;

  return new Response(JSON.stringify(status, null, 2), {
    status: httpStatus,
    headers: { 'Content-Type': 'application/json' },
  });
}
