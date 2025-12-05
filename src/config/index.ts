/**
 * Ankita PubSub - Configuration Management
 *
 * Centralized configuration loaded from environment variables
 * with sensible defaults for development.
 */

export interface Config {
  // Server
  server: {
    port: number;
    host: string;
    env: 'development' | 'staging' | 'production';
  };

  // Authentication
  auth: {
    adminApiKey?: string;
    jwtSecret: string;
    tokenExpiry: number;
    rateLimitRequests: number;
    rateLimitWindowMs: number;
  };

  // Messaging
  messaging: {
    maxQueueSize: number;
    maxMessageSize: number;
    messageRetentionMs: number;
    maxRetries: number;
    deadLetterMaxSize: number;
  };

  // Database
  database: {
    path: string;
    walMode: boolean;
  };

  // Logging
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'pretty';
    includeTimestamp: boolean;
  };

  // Metrics
  metrics: {
    enabled: boolean;
    path: string;
    collectInterval: number;
  };

  // Health
  health: {
    livenessPath: string;
    readinessPath: string;
  };
}

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfig(): Config {
  return {
    server: {
      port: getEnvInt('PORT', 3000),
      host: getEnv('HOST', 'localhost'),
      env: getEnv('NODE_ENV', 'development') as Config['server']['env'],
    },

    auth: {
      adminApiKey: process.env.ADMIN_API_KEY,
      jwtSecret: getEnv('JWT_SECRET', 'ankita-pubsub-secret-change-in-production'),
      tokenExpiry: getEnvInt('TOKEN_EXPIRY_MS', 86400000), // 24 hours
      rateLimitRequests: getEnvInt('RATE_LIMIT_REQUESTS', 1000),
      rateLimitWindowMs: getEnvInt('RATE_LIMIT_WINDOW_MS', 60000),
    },

    messaging: {
      maxQueueSize: getEnvInt('MAX_QUEUE_SIZE', 10000),
      maxMessageSize: getEnvInt('MAX_MESSAGE_SIZE', 1048576), // 1MB
      messageRetentionMs: getEnvInt('MESSAGE_RETENTION_MS', 86400000), // 24 hours
      maxRetries: getEnvInt('MAX_RETRIES', 3),
      deadLetterMaxSize: getEnvInt('DLQ_MAX_SIZE', 1000),
    },

    database: {
      path: getEnv('DATABASE_PATH', 'pubsub.db'),
      walMode: getEnvBool('DATABASE_WAL_MODE', true),
    },

    logging: {
      level: getEnv('LOG_LEVEL', 'info') as Config['logging']['level'],
      format: getEnv('LOG_FORMAT', 'pretty') as Config['logging']['format'],
      includeTimestamp: getEnvBool('LOG_TIMESTAMP', true),
    },

    metrics: {
      enabled: getEnvBool('METRICS_ENABLED', true),
      path: getEnv('METRICS_PATH', '/metrics'),
      collectInterval: getEnvInt('METRICS_COLLECT_INTERVAL', 5000),
    },

    health: {
      livenessPath: getEnv('HEALTH_LIVENESS_PATH', '/health/live'),
      readinessPath: getEnv('HEALTH_READINESS_PATH', '/health/ready'),
    },
  };
}

// Singleton config instance
export const config = loadConfig();

// Validate critical config in production
export function validateConfig(): string[] {
  const errors: string[] = [];

  if (config.server.env === 'production') {
    if (config.auth.jwtSecret === 'ankita-pubsub-secret-change-in-production') {
      errors.push('JWT_SECRET must be set in production');
    }
    if (!config.auth.adminApiKey) {
      errors.push('ADMIN_API_KEY should be set in production');
    }
  }

  return errors;
}

// Export config summary for logging (without secrets)
export function getConfigSummary(): Record<string, unknown> {
  return {
    server: config.server,
    messaging: config.messaging,
    database: { path: config.database.path, walMode: config.database.walMode },
    logging: config.logging,
    metrics: config.metrics,
    health: config.health,
  };
}
