/**
 * Ankita PubSub - Health Check Tests
 *
 * Unit tests for health check endpoints.
 */

import { describe, test, expect } from 'bun:test';

describe('Health Checks', () => {
  const baseUrl = 'http://localhost:3000';

  describe('Liveness Probe', () => {
    test('should return healthy status', async () => {
      const response = await fetch(`${baseUrl}/health/live`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.uptime).toBeDefined();
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('Readiness Probe', () => {
    test('should return health status', async () => {
      const response = await fetch(`${baseUrl}/health/ready`);
      const data = await response.json();

      expect([200, 503]).toContain(response.status);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status);
      expect(data.checks).toBeDefined();
      expect(Array.isArray(data.checks)).toBe(true);
    });
  });

  describe('Detailed Health', () => {
    test('should return detailed health info', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json();

      expect(response.status).toBeLessThan(600);
      expect(data.status).toBeDefined();
      expect(data.checks).toBeDefined();
    });
  });
});

describe('Prometheus Metrics', () => {
  const baseUrl = 'http://localhost:3000';

  test('should return metrics in Prometheus format', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(text).toContain('# HELP');
    expect(text).toContain('# TYPE');
    expect(text).toContain('ankita_');
  });

  test('should include uptime metric', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const text = await response.text();

    expect(text).toContain('ankita_uptime_seconds');
  });

  test('should include memory metrics', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const text = await response.text();

    expect(text).toContain('ankita_memory_heap_used_bytes');
    expect(text).toContain('ankita_memory_rss_bytes');
  });
});
