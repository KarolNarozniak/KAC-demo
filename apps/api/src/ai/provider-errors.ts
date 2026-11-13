export type AiProviderFailure = { status: 429 | 504 | 503; code: 'rate_limited' | 'timed_out' | 'unavailable' };

export function classifyAiProviderFailure(error: unknown): AiProviderFailure {
  const value = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown; name?: unknown } : {};
  const code = typeof value.code === 'string' ? value.code.toLowerCase() : '';
  const name = typeof value.name === 'string' ? value.name.toLowerCase() : '';
  if (value.status === 429 || code.includes('rate_limit')) return { status: 429, code: 'rate_limited' };
  if (name.includes('timeout') || code === 'etimedout' || code === 'timeout') return { status: 504, code: 'timed_out' };
  return { status: 503, code: 'unavailable' };
}

export function safeAiProviderDiagnostics(error: unknown) {
  const value = error && typeof error === 'object' ? error as { name?: unknown; status?: unknown; code?: unknown; requestID?: unknown; request_id?: unknown } : {};
  const safeText = (input: unknown) => typeof input === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(input) ? input : undefined;
  return {
    errorName: safeText(value.name) ?? 'unknown',
    providerStatus: typeof value.status === 'number' && Number.isInteger(value.status) ? value.status : undefined,
    providerCode: safeText(value.code),
    providerRequestId: safeText(value.requestID) ?? safeText(value.request_id),
  };
}
