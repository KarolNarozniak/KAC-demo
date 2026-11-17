// Logi żądań bez danych logowania OAuth (S23KC2S1P2-284, G01).
// Adres powrotu z Google niesie kod autoryzacji i state – w logu zostaje sam fakt żądania, wartości są zamazane.
// Pozostałe pola są takie same jak w domyślnym serializatorze Fastify.
import type { FastifyRequest } from 'fastify';

const SENSITIVE_PARAMS = new Set(['code', 'state', 'token', 'access_token', 'refresh_token', 'id_token']);

export function redactUrl(url: string): string {
  const index = url.indexOf('?');
  if (index < 0) return url;
  const params = new URLSearchParams(url.slice(index + 1));
  const sensitive = [...new Set(params.keys())].filter((key) => SENSITIVE_PARAMS.has(key.toLowerCase()));
  if (!sensitive.length) return url;
  for (const key of sensitive) params.set(key, 'redacted');
  return `${url.slice(0, index)}?${params}`;
}

export const requestLogSerializer = (request: FastifyRequest) => ({
  method: request.method,
  url: redactUrl(request.url),
  version: [request.headers?.['accept-version']].flat().filter(Boolean).join(',') || undefined,
  host: request.host,
  remoteAddress: request.ip,
  remotePort: request.socket?.remotePort,
});
