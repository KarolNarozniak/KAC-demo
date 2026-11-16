// Klient API trwałego połączenia z Google Calendar (S23KC2S1P2-12, G02 / S23KC2S1P2-286).
// Aplikacja dostaje wyłącznie stan połączenia, przyznany dostęp i listę kalendarzy – tokeny zostają na serwerze.
// Jednorazowy import (googleImportApi.ts, S23KC2S1P2-27) ma osobne endpointy.

import { apiBaseUrl } from './importApi';
import {
  apiErrorMessage, type AttemptPurpose, type GoogleAccountView, type GoogleIntegrationStatus, type IntegrationAttempt, type IntegrationCalendar,
} from '../domain/googleIntegration';

export class GoogleIntegrationApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(apiErrorMessage(code));
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    // Brak internetu, serwer KAC wyłączony albo przekroczony czas (2a).
    throw new GoogleIntegrationApiError('network', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleIntegrationApiError(typeof data.error === 'string' ? data.error : `http-${response.status}`, response.status);
  return data as T;
}

const attemptPath = (id: string) => `/api/v1/integrations/google/attempts/${encodeURIComponent(id)}`;

export const getGoogleIntegration = () => call<GoogleIntegrationStatus>('GET', '/api/v1/integrations/google');
export const startGoogleIntegration = (purpose: AttemptPurpose) => call<IntegrationAttempt>('POST', '/api/v1/integrations/google/connect', { purpose });
export const getGoogleIntegrationAttempt = (id: string) => call<IntegrationAttempt>('GET', attemptPath(id));
export const cancelGoogleIntegrationAttempt = (id: string) => call<IntegrationAttempt>('POST', `${attemptPath(id)}/cancel`, {});
/** Makieta zgody Google (serwer bez klienta OAuth): wybór konta i zgoda albo odmowa. */
export const giveGoogleIntegrationDemoConsent = (id: string, allow: boolean, account?: string) =>
  call<IntegrationAttempt>('POST', `${attemptPath(id)}/demo-consent`, { allow, ...(account ? { account } : {}) });
export const listGoogleIntegrationCalendars = () =>
  call<{ account: GoogleAccountView; calendars: IntegrationCalendar[]; complete: boolean }>('GET', '/api/v1/integrations/google/calendars');
