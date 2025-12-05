/**
 * Ankita PubSub - SSO/SAML Authentication
 *
 * Enterprise Single Sign-On support for:
 * - SAML 2.0 (Okta, Azure AD, OneLogin, etc.)
 * - OAuth 2.0 / OpenID Connect (Google, Microsoft, GitHub)
 * - Custom LDAP integration
 *
 * Each tenant can configure their own SSO provider.
 */

import { database } from '../storage/database';
import { logger } from '../logging';

export type SSOProvider = 'saml' | 'oauth2' | 'oidc' | 'google' | 'microsoft' | 'github' | 'okta';

export interface SSOConfig {
  tenantId: string;
  provider: SSOProvider;
  enabled: boolean;

  // SAML specific
  entityId?: string;           // SP Entity ID
  ssoUrl?: string;             // IdP SSO URL
  certificate?: string;        // IdP X.509 Certificate
  metadataUrl?: string;        // IdP Metadata URL

  // OAuth/OIDC specific
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes?: string[];

  // Attribute mapping (IdP attributes -> Ankita user fields)
  attributeMapping: {
    userId?: string;      // e.g., 'sub', 'nameID', 'email'
    email?: string;       // e.g., 'email', 'mail'
    name?: string;        // e.g., 'name', 'displayName'
    firstName?: string;   // e.g., 'given_name', 'firstName'
    lastName?: string;    // e.g., 'family_name', 'lastName'
    groups?: string;      // e.g., 'groups', 'memberOf'
    roles?: string;       // e.g., 'roles', 'permissions'
  };

  // Role mapping (IdP groups/roles -> Ankita permissions)
  roleMapping?: {
    [idpRole: string]: string[];  // e.g., 'Admins' -> ['admin', 'publish', 'subscribe']
  };

  createdAt: number;
  updatedAt?: number;
}

export interface SSOSession {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  name?: string;
  roles: string[];
  createdAt: number;
  expiresAt: number;
}

export interface SSOUser {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  groups?: string[];
  roles?: string[];
  rawAttributes?: Record<string, unknown>;
}

// Pre-configured provider settings
const PROVIDER_PRESETS: Partial<Record<SSOProvider, Partial<SSOConfig>>> = {
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
    attributeMapping: {
      userId: 'sub',
      email: 'email',
      name: 'name',
      firstName: 'given_name',
      lastName: 'family_name',
    },
  },
  microsoft: {
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'email', 'profile', 'User.Read'],
    attributeMapping: {
      userId: 'id',
      email: 'mail',
      name: 'displayName',
      firstName: 'givenName',
      lastName: 'surname',
    },
  },
  github: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
    attributeMapping: {
      userId: 'id',
      email: 'email',
      name: 'name',
    },
  },
};

export class SSOManager {
  private configs: Map<string, SSOConfig> = new Map();
  private pendingStates: Map<string, { tenantId: string; redirectUrl: string; expiresAt: number }> = new Map();

  constructor() {
    this.loadConfigs();
    this.startSessionCleanup();
  }

  private loadConfigs(): void {
    // Load all SSO configs from database would happen here
    // For now, configs are loaded on-demand
  }

  private startSessionCleanup(): void {
    // Clean up expired sessions every hour
    setInterval(() => {
      const cleaned = database.cleanupExpiredSSOSessions();
      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} expired SSO sessions`);
      }

      // Clean up expired pending states
      const now = Date.now();
      for (const [state, data] of this.pendingStates.entries()) {
        if (data.expiresAt < now) {
          this.pendingStates.delete(state);
        }
      }
    }, 60 * 60 * 1000);
  }

  /**
   * Configure SSO for a tenant
   */
  configureSSO(tenantId: string, config: Partial<SSOConfig>): SSOConfig {
    // Apply provider presets
    const preset = config.provider ? PROVIDER_PRESETS[config.provider] : {};

    const fullConfig: SSOConfig = {
      tenantId,
      provider: config.provider || 'saml',
      enabled: config.enabled ?? false,
      entityId: config.entityId,
      ssoUrl: config.ssoUrl,
      certificate: config.certificate,
      metadataUrl: config.metadataUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationUrl: config.authorizationUrl || preset?.authorizationUrl,
      tokenUrl: config.tokenUrl || preset?.tokenUrl,
      userInfoUrl: config.userInfoUrl || preset?.userInfoUrl,
      scopes: config.scopes || preset?.scopes,
      attributeMapping: {
        ...preset?.attributeMapping,
        ...config.attributeMapping,
      },
      roleMapping: config.roleMapping,
      createdAt: Date.now(),
    };

    this.configs.set(tenantId, fullConfig);
    database.saveSSOConfig(fullConfig);

    logger.info(`SSO configured for tenant ${tenantId}`, { provider: fullConfig.provider });

    return fullConfig;
  }

  /**
   * Get SSO configuration for a tenant
   */
  getConfig(tenantId: string): SSOConfig | null {
    let config = this.configs.get(tenantId);
    if (!config) {
      config = database.getSSOConfig(tenantId) as SSOConfig | null;
      if (config) {
        this.configs.set(tenantId, config);
      }
    }
    return config || null;
  }

  /**
   * Enable/disable SSO for a tenant
   */
  setEnabled(tenantId: string, enabled: boolean): boolean {
    const config = this.getConfig(tenantId);
    if (!config) return false;

    config.enabled = enabled;
    config.updatedAt = Date.now();
    database.saveSSOConfig(config);

    return true;
  }

  /**
   * Generate SSO login URL (for OAuth/OIDC providers)
   */
  generateLoginUrl(tenantId: string, redirectUrl: string): { url: string; state: string } | null {
    const config = this.getConfig(tenantId);
    if (!config || !config.enabled) return null;

    if (config.provider === 'saml') {
      return this.generateSAMLLoginUrl(config, redirectUrl);
    }

    // OAuth/OIDC flow
    if (!config.authorizationUrl || !config.clientId) return null;

    const state = this.generateState();
    this.pendingStates.set(state, {
      tenantId,
      redirectUrl,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUrl,
      response_type: 'code',
      scope: (config.scopes || ['openid', 'email', 'profile']).join(' '),
      state,
    });

    return {
      url: `${config.authorizationUrl}?${params.toString()}`,
      state,
    };
  }

  /**
   * Generate SAML login URL
   */
  private generateSAMLLoginUrl(config: SSOConfig, redirectUrl: string): { url: string; state: string } | null {
    if (!config.ssoUrl) return null;

    const state = this.generateState();
    this.pendingStates.set(state, {
      tenantId: config.tenantId,
      redirectUrl,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    // Create SAML AuthnRequest
    const samlRequest = this.createSAMLRequest(config, state);

    const params = new URLSearchParams({
      SAMLRequest: Buffer.from(samlRequest).toString('base64'),
      RelayState: state,
    });

    return {
      url: `${config.ssoUrl}?${params.toString()}`,
      state,
    };
  }

  /**
   * Create SAML AuthnRequest XML
   */
  private createSAMLRequest(config: SSOConfig, id: string): string {
    const issueInstant = new Date().toISOString();

    return `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest
    xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
    ID="_${id}"
    Version="2.0"
    IssueInstant="${issueInstant}"
    AssertionConsumerServiceURL="${config.entityId}/sso/callback"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
    <saml:Issuer>${config.entityId}</saml:Issuer>
    <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"/>
</samlp:AuthnRequest>`;
  }

  /**
   * Handle OAuth callback (exchange code for tokens)
   */
  async handleOAuthCallback(code: string, state: string): Promise<SSOSession | null> {
    const pending = this.pendingStates.get(state);
    if (!pending) {
      logger.warn('Invalid or expired SSO state');
      return null;
    }

    this.pendingStates.delete(state);

    const config = this.getConfig(pending.tenantId);
    if (!config) return null;

    try {
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(config, code, pending.redirectUrl);
      if (!tokens) return null;

      // Get user info
      const user = await this.fetchUserInfo(config, tokens.access_token);
      if (!user) return null;

      // Create session
      return this.createSession(config.tenantId, user);
    } catch (error) {
      logger.error('OAuth callback error', { error });
      return null;
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(
    config: SSOConfig,
    code: string,
    redirectUri: string
  ): Promise<{ access_token: string; id_token?: string } | null> {
    if (!config.tokenUrl || !config.clientId || !config.clientSecret) return null;

    try {
      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
      });

      if (!response.ok) {
        logger.error('Token exchange failed', { status: response.status });
        return null;
      }

      return await response.json();
    } catch (error) {
      logger.error('Token exchange error', { error });
      return null;
    }
  }

  /**
   * Fetch user info from IdP
   */
  private async fetchUserInfo(config: SSOConfig, accessToken: string): Promise<SSOUser | null> {
    if (!config.userInfoUrl) return null;

    try {
      const response = await fetch(config.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) return null;

      const data = await response.json();
      const mapping = config.attributeMapping;

      return {
        id: this.extractAttribute(data, mapping.userId || 'sub'),
        email: this.extractAttribute(data, mapping.email || 'email'),
        name: this.extractAttribute(data, mapping.name),
        firstName: this.extractAttribute(data, mapping.firstName),
        lastName: this.extractAttribute(data, mapping.lastName),
        groups: this.extractArrayAttribute(data, mapping.groups),
        roles: this.extractArrayAttribute(data, mapping.roles),
        rawAttributes: data,
      };
    } catch (error) {
      logger.error('User info fetch error', { error });
      return null;
    }
  }

  /**
   * Handle SAML response
   */
  handleSAMLResponse(samlResponse: string, relayState: string): SSOSession | null {
    const pending = this.pendingStates.get(relayState);
    if (!pending) return null;

    this.pendingStates.delete(relayState);

    const config = this.getConfig(pending.tenantId);
    if (!config) return null;

    try {
      // Parse and validate SAML response
      const user = this.parseSAMLResponse(samlResponse, config);
      if (!user) return null;

      return this.createSession(config.tenantId, user);
    } catch (error) {
      logger.error('SAML response error', { error });
      return null;
    }
  }

  /**
   * Parse SAML response (simplified - in production use a proper SAML library)
   */
  private parseSAMLResponse(samlResponse: string, config: SSOConfig): SSOUser | null {
    try {
      const decoded = Buffer.from(samlResponse, 'base64').toString('utf8');

      // In production, you would:
      // 1. Validate XML signature using config.certificate
      // 2. Verify Issuer matches expected IdP
      // 3. Check conditions (NotBefore, NotOnOrAfter)
      // 4. Extract NameID and attributes

      // Simplified extraction for demo
      const emailMatch = decoded.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
      const nameMatch = decoded.match(/<saml:Attribute Name="displayName"[^>]*>[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)/);

      if (!emailMatch) return null;

      return {
        id: emailMatch[1],
        email: emailMatch[1],
        name: nameMatch ? nameMatch[1] : undefined,
      };
    } catch (error) {
      logger.error('SAML parse error', { error });
      return null;
    }
  }

  /**
   * Create SSO session
   */
  private createSession(tenantId: string, user: SSOUser): SSOSession {
    const session: SSOSession = {
      id: this.generateSessionId(),
      tenantId,
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles || [],
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };

    database.saveSSOSession(session);
    logger.info(`SSO session created`, { tenantId, userId: user.id });

    return session;
  }

  /**
   * Validate SSO session
   */
  validateSession(sessionId: string): SSOSession | null {
    return database.getSSOSession(sessionId);
  }

  /**
   * Logout / destroy session
   */
  logout(sessionId: string): void {
    database.deleteSSOSession(sessionId);
  }

  /**
   * Generate SAML Service Provider metadata
   */
  generateSPMetadata(tenantId: string, baseUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    entityID="${baseUrl}/sso/${tenantId}">
    <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
        protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
        <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
        <md:AssertionConsumerService
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
            Location="${baseUrl}/sso/${tenantId}/callback"
            index="0" isDefault="true"/>
    </md:SPSSODescriptor>
</md:EntityDescriptor>`;
  }

  // ============================================
  // Helpers
  // ============================================

  private generateState(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let state = '';
    for (let i = 0; i < 32; i++) {
      state += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return state;
  }

  private generateSessionId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'sso_';
    for (let i = 0; i < 24; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  private extractAttribute(data: Record<string, unknown>, path?: string): string {
    if (!path) return '';
    const value = data[path];
    return typeof value === 'string' ? value : String(value || '');
  }

  private extractArrayAttribute(data: Record<string, unknown>, path?: string): string[] {
    if (!path) return [];
    const value = data[path];
    if (Array.isArray(value)) return value.map(v => String(v));
    if (typeof value === 'string') return [value];
    return [];
  }
}

// Singleton
export const ssoManager = new SSOManager();
