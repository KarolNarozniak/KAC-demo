
import { randomUUID } from 'node:crypto';

// Types

export type ConnectionStatus =
  | 'pending'
  | 'connected'
  | 'denied'
  | 'error'
  | 'expired'
  | 'disconnected';

export type OAuthFlowStatus =
  | 'created'
  | 'callback_received'
  | 'processing'
  | 'completed'
  | 'failed';

export type GoogleConnectionErrorCode =
  | 'access_denied'
  | 'invalid_grant'
  | 'invalid_state'
  | 'token_exchange_failed'
  | 'missing_refresh_token'
  | 'google_unavailable'
  | 'unknown';

export type PendingGoogleConnection = {
  id: string;
  userId: string;
  state: string;
  codeVerifier: string | null;
  status: ConnectionStatus;
  flowStatus: OAuthFlowStatus;
  googleSub: string | null;
  email: string | null;
  error: GoogleConnectionErrorCode | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  completedAt: number | null;
};

export type GoogleIntegration = {
  id: string;
  userId: string;
  googleSub: string;
  email: string;
  status: 'connected' | 'disconnected';
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
  connectedAt: number;
  disconnectedAt: number | null;
  lastSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateConnectionInput = {
  userId: string;
  state: string;
  codeVerifier: string;
};

export type CompleteConnectionInput = {
  googleSub: string;
  email: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
};

const PENDING_TTL_MS = 10 * 60_000;

export class GoogleConnectionError extends Error {
  constructor(
    public readonly code: GoogleConnectionErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'GoogleConnectionError';
  }
}

// Service

/**
 * In-memory implementation.
 * Docelowo storage można zastąpić repository PostgreSQL/Prisma.
 */
export class PersistentGoogleConnections {
  private readonly pending = new Map<string, PendingGoogleConnection>();
  private readonly integrations = new Map<string, GoogleIntegration>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly pendingTtlMs = PENDING_TTL_MS,
  ) {}

  // Pending OAuth

  create(input: CreateConnectionInput): PendingGoogleConnection {
    this.prune();

    const timestamp = this.now();

    const connection: PendingGoogleConnection = {
      id: randomUUID(),
      userId: input.userId,
      state: input.state,
      codeVerifier: input.codeVerifier,
      status: 'pending',
      flowStatus: 'created',
      googleSub: null,
      email: null,
      error: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + this.pendingTtlMs,
      completedAt: null,
    };

    this.pending.set(connection.id, connection);
    return { ...connection };
  }

  getPending(id: string): PendingGoogleConnection | null {
    this.prune();
    const connection = this.pending.get(id);
    return connection ? { ...connection } : null;
  }

  getPendingForUser(
    id: string,
    userId: string,
  ): PendingGoogleConnection | null {
    const connection = this.getPending(id);
    return connection?.userId === userId ? connection : null;
  }

  validateState(id: string, receivedState: string): boolean {
    const connection = this.pending.get(id);

    return !!connection &&
      this.isPendingValid(connection) &&
      !!receivedState &&
      connection.state === receivedState;
  }

  consumeVerifier(id: string): string | null {
    const connection = this.pending.get(id);

    if (
      !connection ||
      !this.isPendingValid(connection) ||
      connection.flowStatus !== 'created' ||
      !connection.codeVerifier
    ) {
      return null;
    }

    const verifier = connection.codeVerifier;
    connection.codeVerifier = null;
    connection.flowStatus = 'callback_received';
    connection.updatedAt = this.now();

    return verifier;
  }

  markProcessing(id: string): boolean {
    const connection = this.pending.get(id);

    if (
      !connection ||
      !this.isPendingValid(connection) ||
      connection.flowStatus !== 'callback_received'
    ) {
      return false;
    }

    connection.flowStatus = 'processing';
    connection.updatedAt = this.now();
    return true;
  }

  // OAuth completion

  complete(
    pendingId: string,
    input: CompleteConnectionInput,
  ): GoogleIntegration | null {
    const connection = this.pending.get(pendingId);

    if (
      !connection ||
      !this.isPendingValid(connection) ||
      connection.flowStatus !== 'processing'
    ) {
      return null;
    }

    const timestamp = this.now();
    const existing = this.findIntegrationByGoogleSub(
      connection.userId,
      input.googleSub,
    );

    const refreshToken =
      input.refreshToken ?? existing?.refreshToken ?? null;

    if (!refreshToken) {
      throw new GoogleConnectionError('missing_refresh_token');
    }

    const integration: GoogleIntegration = {
      id: existing?.id ?? randomUUID(),
      userId: connection.userId,
      googleSub: input.googleSub,
      email: input.email,
      status: 'connected',
      accessToken: input.accessToken,
      refreshToken,
      expiresAt: input.expiresAt,
      scopes: [...input.scopes],
      connectedAt: existing?.connectedAt ?? timestamp,
      disconnectedAt: null,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.integrations.set(integration.id, integration);

    connection.status = 'connected';
    connection.flowStatus = 'completed';
    connection.googleSub = input.googleSub;
    connection.email = input.email;
    connection.completedAt = timestamp;
    connection.updatedAt = timestamp;
    connection.codeVerifier = null;
    connection.state = '';

    return { ...integration, scopes: [...integration.scopes] };
  }

  // Failure handling

  deny(id: string): boolean {
    return this.finishPending(id, 'denied');
  }

  fail(
    id: string,
    error: GoogleConnectionErrorCode,
    message?: string,
  ): boolean {
    const connection = this.pending.get(id);

    if (!connection || connection.status !== 'pending') {
      return false;
    }

    connection.status = 'error';
    connection.flowStatus = 'failed';
    connection.error = error;
    connection.errorMessage = message ?? null;
    connection.codeVerifier = null;
    connection.state = '';
    connection.updatedAt = this.now();

    return true;
  }

  cancel(id: string, userId: string): boolean {
    const connection = this.pending.get(id);

    if (
      !connection ||
      connection.userId !== userId ||
      connection.status !== 'pending'
    ) {
      return false;
    }

    connection.status = 'disconnected';
    connection.flowStatus = 'failed';
    connection.codeVerifier = null;
    connection.state = '';
    connection.updatedAt = this.now();

    return true;
  }

  // Integrations

  getIntegration(id: string): GoogleIntegration | null {
    const integration = this.integrations.get(id);

    return integration
      ? { ...integration, scopes: [...integration.scopes] }
      : null;
  }

  getIntegrations(userId: string): GoogleIntegration[] {
    return Array.from(this.integrations.values())
      .filter((item) => item.userId === userId)
      .map((item) => ({ ...item, scopes: [...item.scopes] }));
  }

  getConnectedIntegrations(userId: string): GoogleIntegration[] {
    return this.getIntegrations(userId)
      .filter((item) => item.status === 'connected');
  }

  findIntegrationByGoogleSub(
    userId: string,
    googleSub: string,
  ): GoogleIntegration | null {
    const integration = Array.from(this.integrations.values()).find(
      (item) =>
        item.userId === userId &&
        item.googleSub === googleSub,
    );

    return integration
      ? { ...integration, scopes: [...integration.scopes] }
      : null;
  }

  updateTokens(
    id: string,
    tokens: {
      accessToken: string;
      refreshToken?: string | null;
      expiresAt: number;
      scopes?: string[];
    },
  ): boolean {
    const integration = this.integrations.get(id);

    if (!integration || integration.status !== 'connected') {
      return false;
    }

    integration.accessToken = tokens.accessToken;

    if (tokens.refreshToken) {
      integration.refreshToken = tokens.refreshToken;
    }

    integration.expiresAt = tokens.expiresAt;

    if (tokens.scopes) {
      integration.scopes = [...tokens.scopes];
    }

    integration.updatedAt = this.now();
    return true;
  }

  markSynced(id: string): boolean {
    const integration = this.integrations.get(id);

    if (!integration || integration.status !== 'connected') {
      return false;
    }

    integration.lastSyncedAt = this.now();
    integration.updatedAt = this.now();
    return true;
  }

  disconnect(id: string, userId: string): boolean {
    const integration = this.integrations.get(id);

    if (
      !integration ||
      integration.userId !== userId ||
      integration.status !== 'connected'
    ) {
      return false;
    }

    integration.status = 'disconnected';
    integration.accessToken = null;
    integration.refreshToken = null;
    integration.expiresAt = null;
    integration.disconnectedAt = this.now();
    integration.updatedAt = this.now();

    return true;
  }

  // Maintenance

  prune(): number {
    const timestamp = this.now();
    let removed = 0;

    for (const [id, connection] of this.pending) {
      if (
        connection.expiresAt <= timestamp &&
        connection.status === 'pending'
      ) {
        connection.status = 'expired';
        connection.flowStatus = 'failed';
        connection.codeVerifier = null;
        connection.state = '';
        connection.updatedAt = timestamp;
        removed++;
      }

      if (connection.expiresAt + this.pendingTtlMs <= timestamp) {
        this.pending.delete(id);
      }
    }

    return removed;
  }

  getPendingCount(userId?: string): number {
    this.prune();

    return Array.from(this.pending.values()).filter(
      (item) =>
        item.status === 'pending' &&
        (!userId || item.userId === userId),
    ).length;
  }

  // Internal

  private isPendingValid(
    connection: PendingGoogleConnection,
  ): boolean {
    if (connection.status !== 'pending') return false;

    if (connection.expiresAt <= this.now()) {
      connection.status = 'expired';
      connection.flowStatus = 'failed';
      connection.codeVerifier = null;
      connection.state = '';
      connection.updatedAt = this.now();
      return false;
    }

    return true;
  }

  private finishPending(
    id: string,
    status: 'denied',
  ): boolean {
    const connection = this.pending.get(id);

    if (!connection || connection.status !== 'pending') {
      return false;
    }

    connection.status = status;
    connection.flowStatus = 'failed';
    connection.codeVerifier = null;
    connection.state = '';
    connection.updatedAt = this.now();

    return true;
  }
}
