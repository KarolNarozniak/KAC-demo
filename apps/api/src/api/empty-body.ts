// Żądanie bez treści, ale z nagłówkiem „Transfer-Encoding: chunked” i bez Content-Type – tak serwer pośredniczący Azure App Service
// potrafi przekazać np. DELETE wysłany przez przeglądarkę bez treści. Fastify uznaje wtedy, że jest treść w nieznanym formacie, i zwraca
// 415 Unsupported Media Type (np. „Odłącz konto Google”). Ten parser przyjmuje pustą treść jako brak treści; niepusta treść bez
// Content-Type albo w nieobsługiwanym formacie nadal dostaje 415.
import type { FastifyInstance } from 'fastify';

export function acceptEmptyBodies(app: FastifyInstance): void {
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 }, (_request, body, done) => {
    if ((body as Buffer).length === 0) return done(null, undefined);
    done(Object.assign(new Error('Unsupported Media Type'), { statusCode: 415, code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' }));
  });
}
