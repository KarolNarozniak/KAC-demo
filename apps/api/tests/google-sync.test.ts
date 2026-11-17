// Klasy błędów synchronizacji i ponowienia (S23KC2S1P2-17, G06) – bez bazy danych.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleIntegrationError } from '../src/integrations/google/oauth-client.js';
import { classifySyncError, isTransientCode } from '../src/integrations/google/sync.js';

test('błędy synchronizacji: brak sieci, wygasłe logowanie, brak uprawnień, limit i błąd serwera są rozróżnione', () => {
  assert.deepEqual(['network_error', 'reconnect_required', 'insufficient_permissions', 'calendar_not_found', 'rate_limited', 'google_unavailable', 'api_not_enabled', 'sync_interrupted']
    .map(classifySyncError), ['network', 'reconnect', 'permissions', 'permissions', 'rate_limit', 'server', 'server', 'other']);
  assert.equal(classifySyncError(null), null);
});

test('ponawiane są tylko błędy przejściowe – brak zgody i brak uprawnień nie', () => {
  for (const code of ['network_error', 'google_unavailable', 'rate_limited']) {
    assert.equal(isTransientCode(code), true, code);
    assert.equal(new GoogleIntegrationError(code as never).transient, true, code);
  }
  for (const code of ['reconnect_required', 'insufficient_permissions', 'api_not_enabled', 'google_error', null]) assert.equal(isTransientCode(code), false, String(code));
});
