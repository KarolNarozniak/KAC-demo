import type { Pool } from 'pg';
import type { UserScope } from '../api/scope.js';

export type AiMessageRole = 'user' | 'assistant' | 'tool';
export type AiConversation = { id: string; modelDeployment: string; title: string; status: 'active' | 'closed' | 'expired'; createdAt: string; updatedAt: string; expiresAt: string };
export type AiMessage = { id: string; role: AiMessageRole; content: Record<string, unknown>; createdAt: string };
export type AiPendingAction = { id: string; conversationId: string; kind: string; payload: Record<string, unknown>; status: string; expiresAt: string; eventId?: string };

export class AiConversationNotFoundError extends Error {}
export class AiActionNotFoundError extends Error {}
export class AiActionConflictError extends Error {}

export class AiRepository {
  constructor(private readonly pool: Pool) {}

  async createConversation(scope: UserScope, modelDeployment: string, retentionDays: number, title = 'Nowa rozmowa'): Promise<AiConversation> {
    const result = await this.pool.query(`insert into t_ai_rozmowy
      (id_uzytkownika, id_kalendarza, model_deployment, title, expires_at)
      values ($1, $2, $3, $4, now() + make_interval(days => $5))
      returning id_rozmowy, model_deployment, title, status, created_at, updated_at, expires_at`,
    [scope.userId, scope.calendarId, modelDeployment, title.slice(0, 120), retentionDays]);
    return this.toConversation(result.rows[0]);
  }

  async getConversation(scope: UserScope, conversationId: string): Promise<AiConversation | null> {
    const result = await this.pool.query(`update t_ai_rozmowy set status = 'expired', updated_at = now()
      where id_rozmowy = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'active' and expires_at <= now()
      returning id_rozmowy`, [conversationId, scope.userId, scope.calendarId]);
    if (result.rowCount) return null;
    const conversation = await this.pool.query(`select id_rozmowy, model_deployment, title, status, created_at, updated_at, expires_at
      from t_ai_rozmowy where id_rozmowy = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'active'`,
    [conversationId, scope.userId, scope.calendarId]);
    return conversation.rows[0] ? this.toConversation(conversation.rows[0]) : null;
  }

  async listConversations(scope: UserScope, limit = 30): Promise<AiConversation[]> {
    const result = await this.pool.query(`select id_rozmowy, model_deployment, title, status, created_at, updated_at, expires_at
      from t_ai_rozmowy where id_uzytkownika = $1 and id_kalendarza = $2 and status = 'active' and expires_at > now()
      order by updated_at desc limit $3`, [scope.userId, scope.calendarId, Math.min(Math.max(limit, 1), 100)]);
    return result.rows.map((row) => this.toConversation(row));
  }

  async appendMessage(scope: UserScope, conversationId: string, role: AiMessageRole, content: Record<string, unknown>, retentionDays = 30): Promise<AiMessage> {
    const result = await this.pool.query(`with owned as (
        update t_ai_rozmowy set updated_at = now(), expires_at = now() + make_interval(days => $5),
          title = case when $4 = 'user' and title = 'Nowa rozmowa' and length(btrim($6::jsonb->>'text')) > 0
            then left(btrim($6::jsonb->>'text'), 120) else title end
        where id_rozmowy = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'active' and expires_at > now()
        returning id_rozmowy
      ) insert into t_ai_wiadomosci (id_rozmowy, rola, tresc, message_order)
        select owned.id_rozmowy, $4, $6::jsonb,
          coalesce((select max(message_order) + 1 from t_ai_wiadomosci where id_rozmowy = owned.id_rozmowy), 1)
        from owned
        returning id_wiadomosci, rola, tresc, created_at`,
      [conversationId, scope.userId, scope.calendarId, role, retentionDays, JSON.stringify(content)]);
    if (!result.rowCount) throw new AiConversationNotFoundError('ai_conversation_not_found_or_expired');
    return this.toMessage(result.rows[0]);
  }

  async listMessages(scope: UserScope, conversationId: string, limit = 100): Promise<AiMessage[]> {
    const owner = await this.pool.query(`select 1 from t_ai_rozmowy where id_rozmowy = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'active' and expires_at > now()`,
    [conversationId, scope.userId, scope.calendarId]);
    if (!owner.rowCount) throw new AiConversationNotFoundError('ai_conversation_not_found_or_expired');
    const messages = await this.pool.query(`select id_wiadomosci, rola, tresc, created_at from (
        select id_wiadomosci, rola, tresc, created_at, message_order from t_ai_wiadomosci where id_rozmowy = $1 order by message_order desc limit $2
      ) recent order by message_order asc`, [conversationId, Math.min(Math.max(limit, 1), 200)]);
    return messages.rows.map((row) => this.toMessage(row));
  }

  async listPendingActions(scope: UserScope, conversationId: string): Promise<AiPendingAction[]> {
    await this.pool.query(`update t_ai_akcje set status = 'expired', updated_at = now()
      where id_rozmowy = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'pending' and expires_at <= now()`,
    [conversationId, scope.userId, scope.calendarId]);
    const actions = await this.pool.query(`select id_akcji, id_rozmowy, typ, argumenty, status, expires_at, id_zdarzenia
      from t_ai_akcje where id_rozmowy = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'pending' and expires_at > now()
      order by created_at asc`, [conversationId, scope.userId, scope.calendarId]);
    return actions.rows.map((row) => this.toAction(row));
  }

  async closeConversation(scope: UserScope, conversationId: string): Promise<boolean> {
    const result = await this.pool.query(`delete from t_ai_rozmowy
      where id_rozmowy = $1 and id_uzytkownika = $2 and id_kalendarza = $3 returning id_rozmowy`, [conversationId, scope.userId, scope.calendarId]);
    return Boolean(result.rowCount);
  }

  async expireConversationRetention(limit = 100): Promise<number> {
    const result = await this.pool.query(`with expired as (
        select id_rozmowy from t_ai_rozmowy where expires_at <= now()
        order by expires_at asc limit $1 for update skip locked
      ) delete from t_ai_rozmowy c using expired where c.id_rozmowy = expired.id_rozmowy returning c.id_rozmowy`, [Math.min(Math.max(limit, 1), 500)]);
    return result.rowCount ?? 0;
  }

  async expirePendingActions(limit = 500): Promise<number> {
    const result = await this.pool.query(`with expired as (
        select id_akcji from t_ai_akcje where status = 'pending' and expires_at <= now()
        order by expires_at asc limit $1 for update skip locked
      ) update t_ai_akcje a set status = 'expired', completed_at = now(), updated_at = now()
        from expired where a.id_akcji = expired.id_akcji returning a.id_akcji`, [Math.min(Math.max(limit, 1), 1000)]);
    return result.rowCount ?? 0;
  }

  async purgeUsageBefore(days = 365): Promise<number> {
    const result = await this.pool.query(`delete from t_ai_uzycie where created_at < now() - make_interval(days => $1) returning id_zdarzenia`, [days]);
    return result.rowCount ?? 0;
  }

  async logUsage(scope: UserScope, operation: string, model: string, inputTokens: number, outputTokens: number, elapsedMs: number, status: 'ok' | 'error', errorCode?: string) {
    await this.pool.query(`insert into t_ai_uzycie
      (id_uzytkownika, operacja, model, tokeny_we, tokeny_wy, czas_ms, status, kod_bledu)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [scope.userId, operation, model, Math.max(0, inputTokens), Math.max(0, outputTokens), Math.max(0, elapsedMs), status, errorCode ?? null]);
  }

  async createAction(scope: UserScope, conversationId: string, kind: string, payload: Record<string, unknown>, ttlMinutes: number): Promise<AiPendingAction> {
    const result = await this.pool.query(`insert into t_ai_akcje
      (id_rozmowy, id_uzytkownika, id_kalendarza, typ, argumenty, idempotency_key, expires_at)
      select c.id_rozmowy, $2, $3, $4, $5::jsonb, gen_random_uuid()::text, now() + make_interval(mins => $6)
      from t_ai_rozmowy c where c.id_rozmowy = $1 and c.id_uzytkownika = $2 and c.id_kalendarza = $3 and c.status = 'active' and c.expires_at > now()
      returning id_akcji, id_rozmowy, typ, argumenty, status, expires_at, id_zdarzenia`,
    [conversationId, scope.userId, scope.calendarId, kind, JSON.stringify(payload), ttlMinutes]);
    if (!result.rowCount) throw new AiConversationNotFoundError('ai_conversation_not_found_or_expired');
    return this.toAction(result.rows[0]);
  }

  async getAction(scope: UserScope, actionId: string): Promise<AiPendingAction | null> {
    const result = await this.pool.query(`update t_ai_akcje set status = 'expired'
      where id_akcji = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'pending' and expires_at <= now()
      returning id_akcji`, [actionId, scope.userId, scope.calendarId]);
    if (result.rowCount) return null;
    const action = await this.pool.query(`select id_akcji, id_rozmowy, typ, argumenty, status, expires_at, id_zdarzenia
      from t_ai_akcje where id_akcji = $1 and id_uzytkownika = $2 and id_kalendarza = $3`, [actionId, scope.userId, scope.calendarId]);
    return action.rows[0] ? this.toAction(action.rows[0]) : null;
  }

  async claimAction(scope: UserScope, actionId: string): Promise<AiPendingAction> {
    const result = await this.pool.query(`update t_ai_akcje set status = 'processing', updated_at = now()
      where id_akcji = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and expires_at > now()
        and (status = 'pending' or (status = 'processing' and updated_at < now() - interval '2 minutes'))
      returning id_akcji, id_rozmowy, typ, argumenty, status, expires_at, id_zdarzenia`, [actionId, scope.userId, scope.calendarId]);
    if (result.rows[0]) return this.toAction(result.rows[0]);
    const current = await this.getAction(scope, actionId);
    if (!current) throw new AiActionNotFoundError('ai_action_not_found_or_expired');
    if (current.status === 'confirmed') return current;
    throw new AiActionConflictError(`ai_action_${current.status}`);
  }

  async completeAction(scope: UserScope, actionId: string, eventId: string | null) {
    const result = await this.pool.query(`update t_ai_akcje set status = 'confirmed', id_zdarzenia = $4, completed_at = now(), updated_at = now()
      where id_akcji = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status in ('processing', 'confirmed')
      returning id_akcji`, [actionId, scope.userId, scope.calendarId, eventId]);
    if (!result.rowCount) throw new AiActionConflictError('ai_action_state_changed');
  }

  async releaseAction(scope: UserScope, actionId: string, errorCode: string) {
    await this.pool.query(`update t_ai_akcje set status = 'pending', blad_kod = $4, updated_at = now()
      where id_akcji = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'processing'`, [actionId, scope.userId, scope.calendarId, errorCode]);
  }

  async cancelAction(scope: UserScope, actionId: string): Promise<boolean> {
    const result = await this.pool.query(`update t_ai_akcje set status = 'cancelled', completed_at = now(), updated_at = now()
      where id_akcji = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'pending' and expires_at > now()`, [actionId, scope.userId, scope.calendarId]);
    return Boolean(result.rowCount);
  }

  async cancelPendingActions(scope: UserScope, conversationId: string): Promise<void> {
    await this.pool.query(`update t_ai_akcje set status = 'cancelled', completed_at = now(), updated_at = now()
      where id_rozmowy = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'pending'`,
    [conversationId, scope.userId, scope.calendarId]);
  }

  private toConversation(row: Record<string, unknown>): AiConversation {
    return { id: String(row.id_rozmowy), modelDeployment: String(row.model_deployment), title: String(row.title),
      status: row.status as AiConversation['status'], createdAt: new Date(row.created_at as string).toISOString(),
      updatedAt: new Date(row.updated_at as string).toISOString(), expiresAt: new Date(row.expires_at as string).toISOString() };
  }

  private toMessage(row: Record<string, unknown>): AiMessage {
    return { id: String(row.id_wiadomosci), role: row.rola as AiMessageRole, content: row.tresc as Record<string, unknown>,
      createdAt: new Date(row.created_at as string).toISOString() };
  }

  private toAction(row: Record<string, unknown>): AiPendingAction {
    return { id: String(row.id_akcji), conversationId: String(row.id_rozmowy), kind: String(row.typ), payload: row.argumenty as Record<string, unknown>,
      status: String(row.status), expiresAt: new Date(row.expires_at as string).toISOString(), eventId: row.id_zdarzenia ? String(row.id_zdarzenia) : undefined };
  }
}
