// Połączenia z kontem Google trzymane wyłącznie w pamięci serwera (S23KC2S1P2-27).
// Import jest jednorazowy: token nie jest zapisywany w bazie, wygasa po 15 minutach
// i jest usuwany zaraz po odczytaniu wydarzeń do podglądu.

import { randomUUID } from 'node:crypto';

export type ConnectionStatus = 'pending' | 'connected' | 'denied' | 'error' | 'used';

export type GoogleConnection = {
  id: string;
  userId: string;
  calendarId: string;
  mode: 'google' | 'demo';
  status: ConnectionStatus;
  email: string | null;
  accessToken: string | null;
  codeVerifier: string | null;
  createdAt: number;
};

export const CONNECTION_TTL_MS = 15 * 60_000;
const MAX_CONNECTIONS = 200;

export class GoogleConnections {
  private readonly items = new Map<string, GoogleConnection>();

  constructor(private readonly now: () => number = Date.now) {}

  create(mode: 'google' | 'demo', codeVerifier: string | null, userId: string, calendarId: string): GoogleConnection {
    this.prune();
    if (this.items.size >= MAX_CONNECTIONS) {
      const oldest = [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.items.delete(oldest.id);
    }
    const connection: GoogleConnection = { id: randomUUID(), userId, calendarId, mode, status: 'pending', email: null, accessToken: null, codeVerifier, createdAt: this.now() };
    this.items.set(connection.id, connection);
    return connection;
  }

  get(id: string, userId?: string, calendarId?: string): GoogleConnection | null {
    this.prune();
    const connection = this.items.get(id);
    if (!connection || (userId && connection.userId !== userId) || (calendarId && connection.calendarId !== calendarId)) return null;
    return connection;
  }

  update(id: string, change: Partial<Omit<GoogleConnection, 'id' | 'mode' | 'createdAt' | 'userId' | 'calendarId'>>, userId?: string, calendarId?: string): GoogleConnection | null {
    const connection = this.get(id, userId, calendarId);
    if (!connection) return null;
    Object.assign(connection, change);
    return connection;
  }

  /** Jednorazowość: po odczycie wydarzeń token jest zapominany. */
  markUsed(id: string, userId?: string, calendarId?: string) {
    this.update(id, { status: 'used', accessToken: null, codeVerifier: null }, userId, calendarId);
  }

  delete(id: string, userId?: string, calendarId?: string): boolean {
    if (!this.get(id, userId, calendarId)) return false;
    return this.items.delete(id);
  }

  private prune() {
    const limit = this.now() - CONNECTION_TTL_MS;
    for (const [id, connection] of this.items) if (connection.createdAt < limit) this.items.delete(id);
  }
}
