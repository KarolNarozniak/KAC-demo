import type { FastifyInstance } from 'fastify';
import { ProfileError } from '../../../profile/availability.js';
import type { SchedulingRepository } from '../../../scheduling/work-profile-repository.js';
const id = { type: 'string', minLength: 1, maxLength: 100 };
const timestamp = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:00(?:\\.000)?(?:Z|[+-]\\d{2}:\\d{2})$' };
export function registerScheduling(app: FastifyInstance, repo: SchedulingRepository | null, user: string, calendar: string) {
    const run = async (reply: any, fn: () => Promise<unknown>) => { if (!repo)
        return reply.code(503).send({ error: 'database_not_configured' }); try {
        return await fn();
    }
    catch (e) {
        if (e instanceof ProfileError)
            return reply.code(e.status).send({ error: e.code, details: e.details });
        app.log.error(e);
        return reply.code(503).send({ error: 'database_unavailable' });
    } };
    app.post<{
        Body: {
            week: string;
        };
    }>('/work-profile/schedules/generate', { schema: { body: { type: 'object', additionalProperties: false, required: ['week'], properties: { week: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } } } }, async (req, reply) => run(reply, () => {
        const date = new Date(req.body.week + 'T12:00:00Z');
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== req.body.week || date.getUTCDay() !== 1)
            throw new ProfileError('invalid_week', 400);
        return repo!.generate(user, calendar, req.body.week);
    }));
    app.get<{
        Querystring: {
            week: string;
        };
    }>('/work-profile/schedules', { schema: { querystring: { type: 'object', additionalProperties: false, required: ['week'], properties: { week: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } } } }, async (req, reply) => run(reply, () => { const d = new Date(req.query.week + 'T12:00:00Z'); if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== req.query.week || d.getUTCDay() !== 1)
        throw new ProfileError('invalid_week', 400); return repo!.list(user, req.query.week); }));
    const params = { type: 'object', additionalProperties: false, required: ['id'], properties: { id } };
    app.get<{
        Params: {
            id: string;
        };
    }>('/work-profile/schedules/:id', { schema: { params } }, async (req, reply) => run(reply, () => repo!.get(req.params.id, user)));
    for (const action of ['accept', 'reject'] as const)
        app.post<{
            Params: {
                id: string;
            };
        }>(`/work-profile/schedules/:id/${action}`, { schema: { params } }, async (req, reply) => run(reply, () => repo!.change(user, calendar, req.params.id, action)));
    app.put<{
        Params: {
            id: string;
            shiftId: string;
        };
        Body: {
            start: string;
            end: string;
        };
    }>('/work-profile/schedules/:id/shifts/:shiftId', { schema: { params: { ...params, required: ['id', 'shiftId'], properties: { id, shiftId: id } }, body: { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: timestamp, end: timestamp } } } }, async (req, reply) => run(reply, () => repo!.change(user, calendar, req.params.id, 'edit', { shiftId: req.params.shiftId, ...req.body })));
}
