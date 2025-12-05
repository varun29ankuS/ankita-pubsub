/**
 * Ankita PubSub System - Logger
 *
 * Simple colored console logger for development and debugging.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const COLORS = {
  reset: '\x1b[0m',
  debug: '\x1b[36m',   // Cyan
  info: '\x1b[32m',    // Green
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

class Logger {
  private minLevel: LogLevel = 'debug';
  private showTimestamp: boolean = true;

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  setShowTimestamp(show: boolean): void {
    this.showTimestamp = show;
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (this.levelPriority[level] < this.levelPriority[this.minLevel]) {
      return;
    }

    const color = COLORS[level];
    const label = LEVEL_LABELS[level];
    const timestamp = this.showTimestamp
      ? `${COLORS.dim}${new Date().toISOString()}${COLORS.reset} `
      : '';

    const formattedMessage = `${timestamp}${color}[${label}]${COLORS.reset} ${message}`;

    if (args.length > 0) {
      console.log(formattedMessage, ...args);
    } else {
      console.log(formattedMessage);
    }
  }

  // Utility for logging objects nicely
  json(label: string, obj: unknown): void {
    this.info(`${label}:`);
    console.log(JSON.stringify(obj, null, 2));
  }

  // Log a separator line
  separator(char: string = '-', length: number = 50): void {
    console.log(COLORS.dim + char.repeat(length) + COLORS.reset);
  }

  // Log a section header
  section(title: string): void {
    this.separator('=');
    console.log(`${COLORS.bold}${title}${COLORS.reset}`);
    this.separator('=');
  }
}

export const logger = new Logger();
