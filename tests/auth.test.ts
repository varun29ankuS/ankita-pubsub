/**
 * Ankita PubSub - Authentication Tests
 *
 * Unit tests for authentication and authorization.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { AuthManager } from '../src/auth/auth';

describe('AuthManager', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    authManager = new AuthManager();
  });

  describe('API Key Authentication', () => {
    test('should authenticate valid API key', () => {
      const key = authManager.createApiKey('test-client', 'Test Key', ['publish']);
      const result = authManager.authenticate(key.key);

      expect(result.success).toBe(true);
      expect(result.clientId).toBe('test-client');
    });

    test('should reject invalid API key', () => {
      const result = authManager.authenticate('invalid-key-12345');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should return permissions with authentication', () => {
      const key = authManager.createApiKey('admin-client', 'Admin Key', ['admin', 'publish', 'subscribe']);
      const result = authManager.authenticate(key.key);

      expect(result.success).toBe(true);
      expect(result.permissions).toBeDefined();
      expect(result.permissions?.includes('admin')).toBe(true);
    });
  });

  describe('API Key Management', () => {
    test('should create new API key', () => {
      const key = authManager.createApiKey('new-client', 'New Key', ['subscribe']);

      expect(key).toBeDefined();
      expect(key.name).toBe('New Key');
      expect(key.clientId).toBe('new-client');
      expect(key.key).toBeDefined();
      expect(key.key.startsWith('ak_')).toBe(true);
    });

    test('should list all API keys', () => {
      authManager.createApiKey('client-1', 'Key 1', ['publish']);
      authManager.createApiKey('client-2', 'Key 2', ['subscribe']);

      const keys = authManager.getAllKeys();

      // Should include default keys plus our new ones
      expect(keys.length).toBeGreaterThanOrEqual(2);
    });

    test('should revoke API key', () => {
      const key = authManager.createApiKey('temp-client', 'Temp Key', ['publish']);
      authManager.revokeKey(key.key);

      const result = authManager.authenticate(key.key);
      expect(result.success).toBe(false);
    });

    test('should get key by client ID', () => {
      authManager.createApiKey('specific-client', 'Test Key', ['publish']);
      const key = authManager.getKeyByClientId('specific-client');

      expect(key).toBeDefined();
      expect(key!.name).toBe('Test Key');
    });
  });

  describe('Rate Limiting', () => {
    test('should allow requests within rate limit', () => {
      const key = authManager.createApiKey('rate-client', 'Rate Test', ['publish'], {
        rateLimit: { maxRequests: 10, windowMs: 60000 },
      });

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        const result = authManager.authenticate(key.key);
        expect(result.success).toBe(true);
      }
    });

    test('should block requests exceeding rate limit', () => {
      const key = authManager.createApiKey('rate-client-2', 'Rate Test', ['publish'], {
        rateLimit: { maxRequests: 3, windowMs: 60000 },
      });

      // Make requests up to the limit
      for (let i = 0; i < 3; i++) {
        authManager.authenticate(key.key);
      }

      // This one should be rate limited
      const result = authManager.authenticate(key.key);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit');
    });
  });

  describe('Permissions', () => {
    test('admin permission should have all access', () => {
      const key = authManager.createApiKey('admin-test', 'Admin', ['admin']);
      const result = authManager.authenticate(key.key);

      expect(result.permissions).toContain('admin');
      expect(authManager.hasPermission(key.key, 'publish')).toBe(true);
      expect(authManager.hasPermission(key.key, 'subscribe')).toBe(true);
    });

    test('publisher role should have publish permissions', () => {
      const key = authManager.createApiKey('pub-test', 'Publisher', ['publish']);
      const result = authManager.authenticate(key.key);

      expect(result.permissions).toContain('publish');
    });

    test('subscriber role should have subscribe permissions', () => {
      const key = authManager.createApiKey('sub-test', 'Subscriber', ['subscribe']);
      const result = authManager.authenticate(key.key);

      expect(result.permissions).toContain('subscribe');
    });
  });
});
