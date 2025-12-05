/**
 * Ankita PubSub System - Authentication
 *
 * API key-based authentication with rate limiting and permissions.
 */

import type { ApiKey, Permission, AuthResult, RateLimit } from '../pubsub/types';

export class AuthManager {
  private apiKeys: Map<string, ApiKey> = new Map();
  private keysByClientId: Map<string, string> = new Map();

  constructor() {
    // Create default admin key for dashboard
    this.createApiKey('admin', 'Dashboard Admin', [
      'publish',
      'subscribe',
      'admin',
      'topic:create',
      'topic:delete',
      'metrics:read',
    ]);

    // Create demo keys for testing
    this.createApiKey('publisher-1', 'Demo Publisher', ['publish', 'topic:create']);
    this.createApiKey('subscriber-1', 'Demo Subscriber', ['subscribe']);
    this.createApiKey('service-1', 'Demo Service', ['publish', 'subscribe', 'topic:create']);
  }

  /**
   * Create a new API key
   */
  createApiKey(
    clientId: string,
    name: string,
    permissions: Permission[],
    options: {
      expiresIn?: number;
      rateLimit?: { maxRequests: number; windowMs: number };
    } = {}
  ): ApiKey {
    const key = this.generateApiKey();

    const apiKey: ApiKey = {
      key,
      clientId,
      name,
      permissions,
      createdAt: Date.now(),
      expiresAt: options.expiresIn ? Date.now() + options.expiresIn : undefined,
      rateLimit: {
        maxRequests: options.rateLimit?.maxRequests || 1000,
        windowMs: options.rateLimit?.windowMs || 60000,
        currentRequests: 0,
        windowStart: Date.now(),
      },
      isActive: true,
    };

    this.apiKeys.set(key, apiKey);
    this.keysByClientId.set(clientId, key);

    return apiKey;
  }

  /**
   * Authenticate an API key
   */
  authenticate(key: string): AuthResult {
    const apiKey = this.apiKeys.get(key);

    if (!apiKey) {
      return { success: false, error: 'Invalid API key' };
    }

    if (!apiKey.isActive) {
      return { success: false, error: 'API key is disabled' };
    }

    if (apiKey.expiresAt && Date.now() > apiKey.expiresAt) {
      return { success: false, error: 'API key has expired' };
    }

    // Check rate limit
    if (!this.checkRateLimit(apiKey)) {
      return { success: false, error: 'Rate limit exceeded' };
    }

    // Increment request count
    apiKey.rateLimit.currentRequests++;

    return {
      success: true,
      clientId: apiKey.clientId,
      permissions: apiKey.permissions,
    };
  }

  /**
   * Check if client has a specific permission
   */
  hasPermission(key: string, permission: Permission): boolean {
    const apiKey = this.apiKeys.get(key);
    if (!apiKey || !apiKey.isActive) return false;

    // Admin has all permissions
    if (apiKey.permissions.includes('admin')) return true;

    return apiKey.permissions.includes(permission);
  }

  /**
   * Get API key by client ID (for admin purposes)
   */
  getKeyByClientId(clientId: string): ApiKey | undefined {
    const key = this.keysByClientId.get(clientId);
    return key ? this.apiKeys.get(key) : undefined;
  }

  /**
   * Get all API keys (masked for security)
   */
  getAllKeys(): Array<Omit<ApiKey, 'key'> & { key: string }> {
    return Array.from(this.apiKeys.values()).map((apiKey) => ({
      ...apiKey,
      key: this.maskKey(apiKey.key),
    }));
  }

  /**
   * Revoke an API key
   */
  revokeKey(key: string): boolean {
    const apiKey = this.apiKeys.get(key);
    if (!apiKey) return false;

    apiKey.isActive = false;
    return true;
  }

  /**
   * Delete an API key
   */
  deleteKey(key: string): boolean {
    const apiKey = this.apiKeys.get(key);
    if (!apiKey) return false;

    this.apiKeys.delete(key);
    this.keysByClientId.delete(apiKey.clientId);
    return true;
  }

  /**
   * Update permissions for an API key
   */
  updatePermissions(key: string, permissions: Permission[]): boolean {
    const apiKey = this.apiKeys.get(key);
    if (!apiKey) return false;

    apiKey.permissions = permissions;
    return true;
  }

  /**
   * Reset rate limit for a key
   */
  resetRateLimit(key: string): boolean {
    const apiKey = this.apiKeys.get(key);
    if (!apiKey) return false;

    apiKey.rateLimit.currentRequests = 0;
    apiKey.rateLimit.windowStart = Date.now();
    return true;
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus(key: string): RateLimit | null {
    const apiKey = this.apiKeys.get(key);
    return apiKey ? { ...apiKey.rateLimit } : null;
  }

  // ============================================
  // Private Helpers
  // ============================================

  private checkRateLimit(apiKey: ApiKey): boolean {
    const now = Date.now();
    const windowEnd = apiKey.rateLimit.windowStart + apiKey.rateLimit.windowMs;

    // Reset window if expired
    if (now > windowEnd) {
      apiKey.rateLimit.currentRequests = 0;
      apiKey.rateLimit.windowStart = now;
      return true;
    }

    return apiKey.rateLimit.currentRequests < apiKey.rateLimit.maxRequests;
  }

  private generateApiKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const segments = [8, 4, 4, 4, 12];
    const parts: string[] = [];

    for (const length of segments) {
      let segment = '';
      for (let i = 0; i < length; i++) {
        segment += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      parts.push(segment);
    }

    return `ak_${parts.join('-')}`;
  }

  private maskKey(key: string): string {
    if (key.length <= 10) return '****';
    return key.substring(0, 6) + '****' + key.substring(key.length - 4);
  }
}

// Singleton instance
export const authManager = new AuthManager();
