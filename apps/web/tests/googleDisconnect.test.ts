// Odłączenie konta Google (S23KC2S1P2-35, G03): stan w KAC i w Google opisany osobno, bez obiecywania cofnięcia, którego nie było.
import assert from 'node:assert/strict';
import test from 'node:test';
import { disconnectNotice, disconnectWarning, importLinkedAccountHint, type DisconnectResult } from '../src/domain/googleIntegration.ts';

const result = (overrides: Partial<DisconnectResult> = {}): DisconnectResult => ({
  status: 'not_connected', account: 'student@example.test', alreadyDisconnected: false, local: 'removed', remote: 'revoked', ...overrides,
});

test('potwierdzenie mówi, co się stanie, że wydarzenia zostają i że wysłanego żądania nie da się cofnąć', () => {
  const google = disconnectWarning('student@example.test', 'google');
  assert.match(google, /Odłączyć konto student@example\.test\?/);
  assert.match(google, /poprosi Google o cofnięcie zgody/);
  assert.match(google, /wydarzenia w KAC zostaną bez zmian/);
  assert.match(google, /nie da się cofnąć/);
  assert.doesNotMatch(disconnectWarning('student.kac.demo@gmail.com', 'demo'), /poprosi Google/);
});

test('wynik: cofnięcie potwierdzone przez Google, nieudane cofnięcie, makieta i powtórne odłączenie', () => {
  const revoked = disconnectNotice(result());
  assert.equal(revoked.tone, 'success');
  assert.match(revoked.text, /usunął dane dostępu.*Google potwierdził cofnięcie zgody/);
  const failed = disconnectNotice(result({ remote: 'failed' }));
  assert.equal(failed.tone, 'error');
  assert.match(failed.text, /Nie udało się jednak cofnąć zgody w Google/);
  assert.doesNotMatch(failed.text, /potwierdził/);
  assert.doesNotMatch(disconnectNotice(result({ remote: 'not_applicable' })).text, /cofnięcie zgody/);
  assert.match(disconnectNotice(result({ alreadyDisconnected: true, account: null, local: 'nothing_to_remove', remote: 'not_applicable' })).text, /było już odłączone/);
});

test('import jednorazowy informuje, że nie korzysta z połączenia z Ustawień', () => {
  assert.match(importLinkedAccountHint('student@example.test'), /student@example\.test.*osobną zgodę/);
});
