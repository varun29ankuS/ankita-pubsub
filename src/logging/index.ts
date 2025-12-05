/**
 * Ankita PubSub - Structured Logging System
 *
 * Enterprise-grade logging with:
 * - Structured JSON output
 * - Correlation IDs for request tracing
 * - Log levels (debug, info, warn, error)
 * - Context enrichment
 * - Pretty formatting for development
 */

import { config } from '../config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  correlationId?: string;
  requestId?: string;
  clientId?: string;
  topic?: string;
  action?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ANSI color codes for pretty formatting
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.dim,
  info: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: '✓',
  warn: '⚠',
  error: '✗',
};

class Logger {
  private minLevel: LogLevel;
  private format: 'json' | 'pretty';
  private includeTimestamp: boolean;
  private defaultContext: LogContext = {};

  constructor() {
    this.minLevel = config.logging.level;
    this.format = config.logging.format;
    this.includeTimestamp = config.logging.includeTimestamp;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, { ...this.defaultContext, ...context });
  }

  /**
   * Set default context for all log entries
   */
  setDefaultContext(context: LogContext): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  /**
   * Format and output a log entry
   */
  log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.defaultContext, ...context },
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // Clean empty context
    if (entry.context && Object.keys(entry.context).length === 0) {
      delete entry.context;
    }

    this.output(entry);
  }

  /**
   * Output the log entry in the configured format
   */
  private output(entry: LogEntry): void {
    const output = this.format === 'json' ? this.formatJson(entry) : this.formatPretty(entry);

    if (entry.level === 'error') {
      console.error(output);
    } else if (entry.level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  /**
   * Format as JSON (for production)
   */
  private formatJson(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  /**
   * Format as pretty output (for development)
   */
  private formatPretty(entry: LogEntry): string {
    const color = LEVEL_COLORS[entry.level];
    const icon = LEVEL_ICONS[entry.level];
    const levelStr = entry.level.toUpperCase().padEnd(5);

    let output = '';

    // Timestamp
    if (this.includeTimestamp) {
      const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      output += `${COLORS.dim}${time}${COLORS.reset} `;
    }

    // Level and icon
    output += `${color}${icon} ${levelStr}${COLORS.reset} `;

    // Message
    output += entry.message;

    // Context
    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = Object.entries(entry.context)
        .map(([k, v]) => `${COLORS.cyan}${k}${COLORS.reset}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ');
      output += ` ${COLORS.dim}[${COLORS.reset}${contextStr}${COLORS.dim}]${COLORS.reset}`;
    }

    // Error stack
    if (entry.error?.stack) {
      output += `\n${COLORS.red}${entry.error.stack}${COLORS.reset}`;
    }

    return output;
  }

  // Convenience methods
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const err = error instanceof Error ? error : undefined;
    this.log('error', message, context, err);
  }
}

/**
 * Child logger with inherited context
 */
class ChildLogger {
  constructor(private parent: Logger, private context: LogContext) {}

  debug(message: string, additionalContext?: LogContext): void {
    this.parent.log('debug', message, { ...this.context, ...additionalContext });
  }

  info(message: string, additionalContext?: LogContext): void {
    this.parent.log('info', message, { ...this.context, ...additionalContext });
  }

  warn(message: string, additionalContext?: LogContext): void {
    this.parent.log('warn', message, { ...this.context, ...additionalContext });
  }

  error(message: string, error?: Error | unknown, additionalContext?: LogContext): void {
    const err = error instanceof Error ? error : undefined;
    this.parent.log('error', message, { ...this.context, ...additionalContext }, err);
  }
}

/**
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a request-scoped logger with correlation ID
 */
export function createRequestLogger(correlationId?: string): ChildLogger {
  return logger.child({
    correlationId: correlationId || generateCorrelationId(),
  });
}

// Singleton logger instance
export const logger = new Logger();

// Re-export for convenience
export { Logger, ChildLogger };
