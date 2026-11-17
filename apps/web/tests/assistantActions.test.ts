import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantApiError, confirmAssistantAction } from '../src/services/assistantApi.ts';

test('assistant preserves collision details and sends explicit acceptance for the same action', async () => {
  const original = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:4000';
  const token = 'a'.repeat(64);
  const paths: string[] = [];
  globalThis.fetch = async (url, init) => {
    paths.push(String(url));
    const body = JSON.parse(String(init?.body));
    if (!body.collisionToken) return new Response(JSON.stringify({ error: 'event_collision', collisionToken: token,
      conflicts: [{ id: 'event', title: 'Zajęcia testowe', start: '2026-11-16T09:00:00Z', end: '2026-11-16T10:00:00Z' }] }), { status: 409 });
    assert.equal(body.collisionToken, token);
    return new Response(JSON.stringify({ status: 'confirmed', eventId: 'created' }), { status: 200 });
  };
  try {
    await assert.rejects(confirmAssistantAction('same-action'), (error: unknown) => {
      assert.ok(error instanceof AssistantApiError);
      assert.equal(error.collisionToken, token);
      assert.equal(error.conflicts[0]?.title, 'Zajęcia testowe');
      return true;
    });
    assert.equal((await confirmAssistantAction('same-action', token)).eventId, 'created');
    assert.equal(paths[0], paths[1]);
  } finally {
    globalThis.fetch = original;
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  }
});

test('confirm all stops on a collision and preserves successful actions for a retry of the remainder', async () => {
  const { confirmAssistantActions } = await import('../src/services/assistantApi.ts');
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:4000';
  const called: string[] = [];
  const confirmed: string[] = [];
  globalThis.fetch = async (url) => {
    const id = String(url).split('/').at(-2)!; called.push(id);
    if (id === 'second') return new Response(JSON.stringify({ error: 'event_collision', conflicts: [], collisionToken: 'a'.repeat(64) }), { status: 409 });
    return new Response(JSON.stringify({ status: 'confirmed', eventId: id }), { status: 200 });
  };
  try {
    await assert.rejects(confirmAssistantActions(['first', 'second', 'third'], (id) => confirmed.push(id)), AssistantApiError);
    assert.deepEqual(called, ['first', 'second']); assert.deepEqual(confirmed, ['first']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  }
});
