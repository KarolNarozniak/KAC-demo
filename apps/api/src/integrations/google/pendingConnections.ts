import { randomUUID } from 'node:crypto';

export type PendingStatus = 'pending' | 'connected' | 'denied' | 'error';
export type PendingConnection = { id: string; userId: string; codeVerifier: string | null; status: PendingStatus; email: string | null; createdAt: number };
const TTL_MS = 10 * 60_000;

export class PendingGoogleConnections {
  private readonly items = new Map<string, PendingConnection>();
  constructor(private readonly now: () => number = Date.now) {}

  create(userId: string, codeVerifier: string): PendingConnection {
    this.prune();
    const connection: PendingConnection = { id: randomUUID(), userId, codeVerifier, status: 'pending', email: null, createdAt: this.now() };
    this.items.set(connection.id, connection);
    return connection;
  }

  get(id: string): PendingConnection | null { this.prune(); return this.items.get(id) ?? null; }

  /** Jednorazowe użycie code_verifier — druga próba wymiany kodu (np. powtórzony callback) dostaje null. */
  consumeVerifier(id: string): string | null {
    const connection = this.get(id);
    if (!connection || connection.status !== 'pending' || !connection.codeVerifier) return null;
    const verifier = connection.codeVerifier;
    connection.codeVerifier = null;
    return verifier;
  }

  setStatus(id: string, status: PendingStatus, email: string | null = null) {
    const connection = this.items.get(id);
    if (connection) { connection.status = status; connection.email = email; }
  }

  private prune() {
    const limit = this.now() - TTL_MS;
    for (const [id, connection] of this.items) if (connection.createdAt < limit) this.items.delete(id);
  }
}