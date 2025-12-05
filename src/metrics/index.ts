/**
 * Ankita PubSub - Prometheus Metrics
 *
 * Enterprise-grade metrics collection with:
 * - Prometheus-compatible text format
 * - Histograms for latency tracking
 * - Counters for throughput
 * - Gauges for current state
 */

import { broker } from '../pubsub/broker';
import { config } from '../config';

// Metric types
type MetricType = 'counter' | 'gauge' | 'histogram';

interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
  labels?: string[];
}

interface MetricValue {
  value: number;
  labels?: Record<string, string>;
}

interface HistogramBucket {
  le: number | '+Inf';
  count: number;
}

interface HistogramValue {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels?: Record<string, string>;
}

// Predefined histogram buckets for latency (in ms)
const LATENCY_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

class MetricsCollector {
  private counters: Map<string, Map<string, number>> = new Map();
  private gauges: Map<string, Map<string, number>> = new Map();
  private histograms: Map<string, Map<string, { values: number[]; sum: number; count: number }>> = new Map();

  private definitions: Map<string, MetricDefinition> = new Map();

  constructor() {
    this.registerDefaultMetrics();
  }

  /**
   * Register default PubSub metrics
   */
  private registerDefaultMetrics(): void {
    // Message metrics
    this.define({
      name: 'ankita_messages_published_total',
      help: 'Total number of messages published',
      type: 'counter',
      labels: ['topic'],
    });

    this.define({
      name: 'ankita_messages_delivered_total',
      help: 'Total number of messages delivered to subscribers',
      type: 'counter',
      labels: ['topic'],
    });

    this.define({
      name: 'ankita_messages_failed_total',
      help: 'Total number of failed message deliveries',
      type: 'counter',
      labels: ['topic', 'reason'],
    });

    this.define({
      name: 'ankita_messages_queued',
      help: 'Current number of messages in queues',
      type: 'gauge',
    });

    this.define({
      name: 'ankita_dead_letter_queue_size',
      help: 'Current size of dead letter queue',
      type: 'gauge',
    });

    // Connection metrics
    this.define({
      name: 'ankita_active_connections',
      help: 'Number of active WebSocket connections',
      type: 'gauge',
    });

    this.define({
      name: 'ankita_subscribers_total',
      help: 'Total number of active subscribers',
      type: 'gauge',
    });

    this.define({
      name: 'ankita_publishers_total',
      help: 'Total number of publishers',
      type: 'gauge',
    });

    // Topic metrics
    this.define({
      name: 'ankita_topics_total',
      help: 'Total number of topics',
      type: 'gauge',
    });

    // Latency metrics
    this.define({
      name: 'ankita_message_processing_duration_ms',
      help: 'Message processing duration in milliseconds',
      type: 'histogram',
      labels: ['topic'],
    });

    this.define({
      name: 'ankita_request_duration_ms',
      help: 'HTTP/WebSocket request duration in milliseconds',
      type: 'histogram',
      labels: ['method', 'path'],
    });

    // System metrics
    this.define({
      name: 'ankita_uptime_seconds',
      help: 'Server uptime in seconds',
      type: 'gauge',
    });

    this.define({
      name: 'ankita_memory_heap_used_bytes',
      help: 'Process heap memory used in bytes',
      type: 'gauge',
    });

    this.define({
      name: 'ankita_memory_heap_total_bytes',
      help: 'Process total heap memory in bytes',
      type: 'gauge',
    });

    this.define({
      name: 'ankita_memory_rss_bytes',
      help: 'Process resident set size in bytes',
      type: 'gauge',
    });
  }

  /**
   * Define a new metric
   */
  define(definition: MetricDefinition): void {
    this.definitions.set(definition.name, definition);

    if (definition.type === 'counter') {
      this.counters.set(definition.name, new Map());
    } else if (definition.type === 'gauge') {
      this.gauges.set(definition.name, new Map());
    } else if (definition.type === 'histogram') {
      this.histograms.set(definition.name, new Map());
    }
  }

  /**
   * Generate label key from labels object
   */
  private labelKey(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return '';
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  /**
   * Increment a counter
   */
  inc(name: string, value: number = 1, labels?: Record<string, string>): void {
    const counter = this.counters.get(name);
    if (!counter) return;

    const key = this.labelKey(labels);
    counter.set(key, (counter.get(key) || 0) + value);
  }

  /**
   * Set a gauge value
   */
  set(name: string, value: number, labels?: Record<string, string>): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;

    const key = this.labelKey(labels);
    gauge.set(key, value);
  }

  /**
   * Observe a histogram value
   */
  observe(name: string, value: number, labels?: Record<string, string>): void {
    const histogram = this.histograms.get(name);
    if (!histogram) return;

    const key = this.labelKey(labels);
    let data = histogram.get(key);
    if (!data) {
      data = { values: [], sum: 0, count: 0 };
      histogram.set(key, data);
    }

    data.values.push(value);
    data.sum += value;
    data.count++;

    // Keep only last 1000 values to prevent memory issues
    if (data.values.length > 1000) {
      data.values = data.values.slice(-1000);
    }
  }

  /**
   * Collect current broker metrics
   */
  private collectBrokerMetrics(): void {
    const metrics = broker.getMetrics();

    this.set('ankita_active_connections', metrics.activeConnections);
    this.set('ankita_subscribers_total', metrics.totalSubscribers);
    this.set('ankita_topics_total', metrics.totalTopics);
    this.set('ankita_messages_queued', metrics.queuedMessages);
    this.set('ankita_dead_letter_queue_size', metrics.deadLetterCount);
    this.set('ankita_uptime_seconds', Math.floor(metrics.uptime / 1000));
    this.set('ankita_memory_heap_used_bytes', metrics.memoryUsage.heapUsed);
    this.set('ankita_memory_heap_total_bytes', metrics.memoryUsage.heapTotal);
    this.set('ankita_memory_rss_bytes', metrics.memoryUsage.rss);

    // Count publishers
    const publishers = broker.getPublishers();
    this.set('ankita_publishers_total', publishers.length);
  }

  /**
   * Format metrics in Prometheus text format
   */
  format(): string {
    // Collect current state
    this.collectBrokerMetrics();

    const lines: string[] = [];

    for (const [name, definition] of this.definitions) {
      lines.push(`# HELP ${name} ${definition.help}`);
      lines.push(`# TYPE ${name} ${definition.type}`);

      if (definition.type === 'counter') {
        const counter = this.counters.get(name)!;
        if (counter.size === 0) {
          lines.push(`${name} 0`);
        } else {
          for (const [key, value] of counter) {
            if (key) {
              lines.push(`${name}{${key}} ${value}`);
            } else {
              lines.push(`${name} ${value}`);
            }
          }
        }
      } else if (definition.type === 'gauge') {
        const gauge = this.gauges.get(name)!;
        if (gauge.size === 0) {
          lines.push(`${name} 0`);
        } else {
          for (const [key, value] of gauge) {
            if (key) {
              lines.push(`${name}{${key}} ${value}`);
            } else {
              lines.push(`${name} ${value}`);
            }
          }
        }
      } else if (definition.type === 'histogram') {
        const histogram = this.histograms.get(name)!;
        for (const [key, data] of histogram) {
          const labelPrefix = key ? `{${key},` : '{';
          const labelSuffix = key ? '}' : '}';

          // Calculate bucket counts
          for (const bucket of LATENCY_BUCKETS) {
            const count = data.values.filter((v) => v <= bucket).length;
            lines.push(`${name}_bucket${labelPrefix}le="${bucket}"${labelSuffix} ${count}`);
          }
          lines.push(`${name}_bucket${labelPrefix}le="+Inf"${labelSuffix} ${data.count}`);
          lines.push(`${name}_sum${key ? `{${key}}` : ''} ${data.sum}`);
          lines.push(`${name}_count${key ? `{${key}}` : ''} ${data.count}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    for (const counter of this.counters.values()) {
      counter.clear();
    }
    for (const gauge of this.gauges.values()) {
      gauge.clear();
    }
    for (const histogram of this.histograms.values()) {
      histogram.clear();
    }
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

/**
 * Timer helper for measuring durations
 */
export function startTimer(): () => number {
  const start = performance.now();
  return () => performance.now() - start;
}

/**
 * Middleware helper to time requests
 */
export function timeRequest(
  method: string,
  path: string,
  fn: () => Promise<Response> | Response
): Promise<Response> | Response {
  const timer = startTimer();
  const result = fn();

  if (result instanceof Promise) {
    return result.finally(() => {
      metrics.observe('ankita_request_duration_ms', timer(), { method, path });
    });
  }

  metrics.observe('ankita_request_duration_ms', timer(), { method, path });
  return result;
}
