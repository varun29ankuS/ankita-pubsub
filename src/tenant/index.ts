/**
 * Ankita PubSub - Multi-Tenancy System
 *
 * Provides complete tenant isolation for SaaS deployments.
 * Each tenant has:
 * - Isolated topics, messages, and subscribers
 * - Usage quotas and limits
 * - Separate API keys
 * - Usage metering for billing
 */

import { database } from '../storage/database';

export interface Tenant {
  id: string;
  name: string;
  slug: string;  // URL-friendly identifier
  plan: 'free' | 'starter' | 'professional' | 'enterprise';
  status: 'active' | 'suspended' | 'pending';
  createdAt: number;

  // Contact info
  email: string;
  company?: string;

  // Limits based on plan
  limits: TenantLimits;

  // Current usage
  usage: TenantUsage;

  // Billing
  stripeCustomerId?: string;
  billingEmail?: string;
}

export interface TenantLimits {
  maxTopics: number;
  maxMessagesPerMonth: number;
  maxMessageSizeBytes: number;
  maxSubscribersPerTopic: number;
  maxApiKeys: number;
  maxConnectionsPerSecond: number;
  retentionDays: number;
  features: {
    deadLetterQueue: boolean;
    consumerGroups: boolean;
    messageReplay: boolean;
    webhooks: boolean;
    customDomain: boolean;
    sla: boolean;
    prioritySupport: boolean;
  };
}

export interface TenantUsage {
  messagesPublished: number;
  messagesDelivered: number;
  bytesTransferred: number;
  apiCalls: number;
  activeConnections: number;
  topicCount: number;
  subscriberCount: number;

  // Time-based tracking
  periodStart: number;  // Start of billing period
  periodEnd: number;    // End of billing period

  // Historical data points for graphs
  hourlyStats: Array<{
    hour: number;
    messages: number;
    bytes: number;
    connections: number;
  }>;
}

// Plan definitions
export const PLANS: Record<string, TenantLimits> = {
  free: {
    maxTopics: 5,
    maxMessagesPerMonth: 10000,
    maxMessageSizeBytes: 64 * 1024,  // 64KB
    maxSubscribersPerTopic: 10,
    maxApiKeys: 2,
    maxConnectionsPerSecond: 10,
    retentionDays: 1,
    features: {
      deadLetterQueue: false,
      consumerGroups: false,
      messageReplay: false,
      webhooks: false,
      customDomain: false,
      sla: false,
      prioritySupport: false,
    },
  },
  starter: {
    maxTopics: 25,
    maxMessagesPerMonth: 100000,
    maxMessageSizeBytes: 256 * 1024,  // 256KB
    maxSubscribersPerTopic: 50,
    maxApiKeys: 5,
    maxConnectionsPerSecond: 50,
    retentionDays: 7,
    features: {
      deadLetterQueue: true,
      consumerGroups: true,
      messageReplay: false,
      webhooks: true,
      customDomain: false,
      sla: false,
      prioritySupport: false,
    },
  },
  professional: {
    maxTopics: 100,
    maxMessagesPerMonth: 1000000,
    maxMessageSizeBytes: 1024 * 1024,  // 1MB
    maxSubscribersPerTopic: 200,
    maxApiKeys: 20,
    maxConnectionsPerSecond: 200,
    retentionDays: 30,
    features: {
      deadLetterQueue: true,
      consumerGroups: true,
      messageReplay: true,
      webhooks: true,
      customDomain: true,
      sla: false,
      prioritySupport: true,
    },
  },
  enterprise: {
    maxTopics: -1,  // Unlimited
    maxMessagesPerMonth: -1,  // Unlimited
    maxMessageSizeBytes: 10 * 1024 * 1024,  // 10MB
    maxSubscribersPerTopic: -1,  // Unlimited
    maxApiKeys: -1,  // Unlimited
    maxConnectionsPerSecond: -1,  // Unlimited
    retentionDays: 365,
    features: {
      deadLetterQueue: true,
      consumerGroups: true,
      messageReplay: true,
      webhooks: true,
      customDomain: true,
      sla: true,
      prioritySupport: true,
    },
  },
};

export class TenantManager {
  private tenants: Map<string, Tenant> = new Map();
  private tenantsBySlug: Map<string, string> = new Map();  // slug -> id
  private usageBuffer: Map<string, Partial<TenantUsage>> = new Map();
  private flushInterval: Timer | null = null;

  constructor() {
    this.loadTenantsFromDatabase();
    this.startUsageFlush();
  }

  private loadTenantsFromDatabase(): void {
    const tenants = database.getAllTenants();
    for (const tenant of tenants) {
      this.tenants.set(tenant.id, tenant);
      this.tenantsBySlug.set(tenant.slug, tenant.id);
    }

    // Create default tenant if none exist
    if (this.tenants.size === 0) {
      this.createTenant({
        name: 'Default Organization',
        slug: 'default',
        email: 'admin@localhost',
        plan: 'professional',
      });
    }
  }

  private startUsageFlush(): void {
    // Flush usage stats to database every minute
    this.flushInterval = setInterval(() => {
      this.flushUsageStats();
    }, 60000);
  }

  private flushUsageStats(): void {
    for (const [tenantId, usage] of this.usageBuffer.entries()) {
      const tenant = this.tenants.get(tenantId);
      if (tenant) {
        // Merge buffered usage into tenant
        tenant.usage.messagesPublished += usage.messagesPublished || 0;
        tenant.usage.messagesDelivered += usage.messagesDelivered || 0;
        tenant.usage.bytesTransferred += usage.bytesTransferred || 0;
        tenant.usage.apiCalls += usage.apiCalls || 0;

        // Save to database
        database.saveTenantUsage(tenantId, tenant.usage);
      }
    }
    this.usageBuffer.clear();
  }

  /**
   * Create a new tenant
   */
  createTenant(options: {
    name: string;
    slug: string;
    email: string;
    company?: string;
    plan?: 'free' | 'starter' | 'professional' | 'enterprise';
  }): Tenant {
    const id = this.generateTenantId();
    const plan = options.plan || 'free';
    const now = Date.now();

    // Calculate billing period (monthly)
    const periodStart = now;
    const periodEnd = now + (30 * 24 * 60 * 60 * 1000);

    const tenant: Tenant = {
      id,
      name: options.name,
      slug: options.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      plan,
      status: 'active',
      createdAt: now,
      email: options.email,
      company: options.company,
      limits: { ...PLANS[plan] },
      usage: {
        messagesPublished: 0,
        messagesDelivered: 0,
        bytesTransferred: 0,
        apiCalls: 0,
        activeConnections: 0,
        topicCount: 0,
        subscriberCount: 0,
        periodStart,
        periodEnd,
        hourlyStats: [],
      },
    };

    this.tenants.set(id, tenant);
    this.tenantsBySlug.set(tenant.slug, id);
    database.saveTenant(tenant);

    return tenant;
  }

  /**
   * Get tenant by ID
   */
  getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  /**
   * Get tenant by slug
   */
  getTenantBySlug(slug: string): Tenant | undefined {
    const id = this.tenantsBySlug.get(slug);
    return id ? this.tenants.get(id) : undefined;
  }

  /**
   * Get all tenants
   */
  getAllTenants(): Tenant[] {
    return Array.from(this.tenants.values());
  }

  /**
   * Update tenant
   */
  updateTenant(id: string, updates: Partial<Omit<Tenant, 'id' | 'createdAt'>>): Tenant | null {
    const tenant = this.tenants.get(id);
    if (!tenant) return null;

    // Update plan limits if plan changed
    if (updates.plan && updates.plan !== tenant.plan) {
      updates.limits = { ...PLANS[updates.plan] };
    }

    Object.assign(tenant, updates);
    database.saveTenant(tenant);
    return tenant;
  }

  /**
   * Suspend a tenant
   */
  suspendTenant(id: string, reason?: string): boolean {
    const tenant = this.tenants.get(id);
    if (!tenant) return false;

    tenant.status = 'suspended';
    database.saveTenant(tenant);
    database.logAudit('tenant.suspended', null, 'tenant', id, { reason });
    return true;
  }

  /**
   * Reactivate a tenant
   */
  reactivateTenant(id: string): boolean {
    const tenant = this.tenants.get(id);
    if (!tenant) return false;

    tenant.status = 'active';
    database.saveTenant(tenant);
    database.logAudit('tenant.reactivated', null, 'tenant', id, {});
    return true;
  }

  /**
   * Check if tenant can perform action (quota check)
   */
  checkQuota(tenantId: string, action: 'publish' | 'subscribe' | 'createTopic' | 'createApiKey', size?: number): {
    allowed: boolean;
    reason?: string;
    usage?: number;
    limit?: number;
  } {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      return { allowed: false, reason: 'Tenant not found' };
    }

    if (tenant.status !== 'active') {
      return { allowed: false, reason: 'Tenant is suspended' };
    }

    const { limits, usage } = tenant;

    switch (action) {
      case 'publish':
        if (limits.maxMessagesPerMonth !== -1 && usage.messagesPublished >= limits.maxMessagesPerMonth) {
          return {
            allowed: false,
            reason: 'Monthly message limit exceeded',
            usage: usage.messagesPublished,
            limit: limits.maxMessagesPerMonth,
          };
        }
        if (size && size > limits.maxMessageSizeBytes) {
          return {
            allowed: false,
            reason: `Message size ${size} exceeds limit ${limits.maxMessageSizeBytes}`,
            usage: size,
            limit: limits.maxMessageSizeBytes,
          };
        }
        break;

      case 'createTopic':
        if (limits.maxTopics !== -1 && usage.topicCount >= limits.maxTopics) {
          return {
            allowed: false,
            reason: 'Topic limit exceeded',
            usage: usage.topicCount,
            limit: limits.maxTopics,
          };
        }
        break;

      case 'createApiKey':
        // Would need to track API key count per tenant
        break;
    }

    return { allowed: true };
  }

  /**
   * Record usage event (buffered for performance)
   */
  recordUsage(tenantId: string, event: {
    type: 'publish' | 'deliver' | 'apiCall' | 'connect' | 'disconnect';
    bytes?: number;
    topic?: string;
  }): void {
    let buffer = this.usageBuffer.get(tenantId);
    if (!buffer) {
      buffer = {};
      this.usageBuffer.set(tenantId, buffer);
    }

    switch (event.type) {
      case 'publish':
        buffer.messagesPublished = (buffer.messagesPublished || 0) + 1;
        buffer.bytesTransferred = (buffer.bytesTransferred || 0) + (event.bytes || 0);
        break;
      case 'deliver':
        buffer.messagesDelivered = (buffer.messagesDelivered || 0) + 1;
        buffer.bytesTransferred = (buffer.bytesTransferred || 0) + (event.bytes || 0);
        break;
      case 'apiCall':
        buffer.apiCalls = (buffer.apiCalls || 0) + 1;
        break;
    }

    // Also update in-memory tenant for real-time quota checks
    const tenant = this.tenants.get(tenantId);
    if (tenant) {
      if (event.type === 'publish') {
        tenant.usage.messagesPublished++;
        tenant.usage.bytesTransferred += event.bytes || 0;
      } else if (event.type === 'deliver') {
        tenant.usage.messagesDelivered++;
      }
    }
  }

  /**
   * Get usage report for billing
   */
  getUsageReport(tenantId: string): {
    tenant: Tenant;
    period: { start: number; end: number };
    usage: TenantUsage;
    percentUsed: {
      messages: number;
      topics: number;
    };
    estimatedCost?: number;
  } | null {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;

    const percentMessages = tenant.limits.maxMessagesPerMonth === -1
      ? 0
      : (tenant.usage.messagesPublished / tenant.limits.maxMessagesPerMonth) * 100;

    const percentTopics = tenant.limits.maxTopics === -1
      ? 0
      : (tenant.usage.topicCount / tenant.limits.maxTopics) * 100;

    return {
      tenant,
      period: {
        start: tenant.usage.periodStart,
        end: tenant.usage.periodEnd,
      },
      usage: tenant.usage,
      percentUsed: {
        messages: Math.min(100, percentMessages),
        topics: Math.min(100, percentTopics),
      },
    };
  }

  /**
   * Reset usage for new billing period
   */
  resetBillingPeriod(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return;

    const now = Date.now();
    tenant.usage = {
      messagesPublished: 0,
      messagesDelivered: 0,
      bytesTransferred: 0,
      apiCalls: 0,
      activeConnections: tenant.usage.activeConnections,
      topicCount: tenant.usage.topicCount,
      subscriberCount: tenant.usage.subscriberCount,
      periodStart: now,
      periodEnd: now + (30 * 24 * 60 * 60 * 1000),
      hourlyStats: [],
    };

    database.saveTenantUsage(tenantId, tenant.usage);
  }

  /**
   * Check if tenant has feature enabled
   */
  hasFeature(tenantId: string, feature: keyof TenantLimits['features']): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    return tenant.limits.features[feature];
  }

  /**
   * Upgrade tenant plan
   */
  upgradePlan(tenantId: string, newPlan: 'starter' | 'professional' | 'enterprise'): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    const planOrder = ['free', 'starter', 'professional', 'enterprise'];
    const currentIndex = planOrder.indexOf(tenant.plan);
    const newIndex = planOrder.indexOf(newPlan);

    if (newIndex <= currentIndex) {
      return false;  // Can't downgrade with this method
    }

    tenant.plan = newPlan;
    tenant.limits = { ...PLANS[newPlan] };
    database.saveTenant(tenant);
    database.logAudit('tenant.upgraded', null, 'tenant', tenantId, {
      from: planOrder[currentIndex],
      to: newPlan
    });

    return true;
  }

  private generateTenantId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'ten_';
    for (let i = 0; i < 16; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushUsageStats();
  }
}

// Singleton
export const tenantManager = new TenantManager();
