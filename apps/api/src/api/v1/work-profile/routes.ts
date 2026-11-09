import { demoScope, type ScopeResolver } from '../../scope.js';
import type { FastifyInstance } from 'fastify';
import { ProfileError, type Interval } from '../../../profile/availability.js';
import type { WorkProfile, WorkProfileRepository } from '../../../profile/compensation-repository.js';
import { rateGrosz } from '../../../scheduling/pay.js';
const nullableNumber = { anyOf: [{ type: 'number', minimum: 0, maximum: 999.99 }, { type: 'null' }] };
export const profileSchema = { type: 'object', additionalProperties: false, required: ['version', 'hourlyRatePln', 'rateKind', 'commuteMinutes', 'minRestMinutes', 'minHours', 'targetHours', 'maxHours'], properties: {
        version: { type: 'integer', minimum: 1 }, hourlyRatePln: { anyOf: [{ type: 'number' }, { type: 'null' }] }, rateKind: { enum: ['gross', 'net', null] },
        commuteMinutes: { anyOf: [{ type: 'integer', minimum: 0, maximum: 10080 }, { type: 'null' }] }, minRestMinutes: { type: 'integer', minimum: 0, maximum: 10080 }, minHours: nullableNumber, targetHours: nullableNumber, maxHours: { anyOf: [{ type: 'number', exclusiveMinimum: 0, maximum: 999.99 }, { type: 'null' }] },
    } } as const;
export const availabilitySchema = { type: 'object', additionalProperties: false, required: ['version', 'intervals'], properties: { version: { type: 'integer', minimum: 1 }, intervals: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: false, required: ['dayOfWeek', 'startTime', 'endTime'], properties: { dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 }, startTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, endTime: { type: 'string', pattern: '^(([01]\\d|2[0-3]):[0-5]\\d|24:00)$' } } } } } } as const;
export function registerWorkProfile(app: FastifyInstance, repository: WorkProfileRepository | null, scope: ScopeResolver = demoScope) {
    const run = async (reply: any, fn: () => Promise<unknown>) => {
        if (!repository)
            return reply.code(503).send({ error: 'database_not_configured' });
        try {
            return await fn();
        }
        catch (e) {
            if (e instanceof ProfileError)
                return reply.code(e.status).send({ error: e.code, details: e.details });
            app.log.error(e);
            return reply.code(503).send({ error: 'database_unavailable' });
        }
    };
    app.get('/work-profile/compensation', async (req, reply) => run(reply, () => repository!.getProfile(scope(req).userId)));
    app.put<{
        Body: WorkProfile;
    }>('/work-profile/compensation', { schema: { body: profileSchema } }, async (req, reply) => run(reply, async () => {
        const p = req.body;
        if (p.hourlyRatePln !== null)
            rateGrosz(p.hourlyRatePln);
        if (p.hourlyRatePln !== null && p.rateKind === null)
            throw new ProfileError('rate_kind_required');
        if ([p.minHours,p.targetHours,p.maxHours].some(value=>value !== null && Number(value.toFixed(2)) !== value)) throw new ProfileError('invalid_hour_limits');
        if (p.minHours !== null && p.maxHours !== null && p.minHours > p.maxHours || p.targetHours !== null && (p.minHours !== null && p.targetHours < p.minHours || p.maxHours !== null && p.targetHours > p.maxHours))
            throw new ProfileError('invalid_hour_limits');
        return repository!.saveProfile(scope(req).userId, p);
    }));
    app.get('/work-profile/availability', async (req, reply) => run(reply, () => repository!.listAvailability(scope(req).userId)));
    app.put<{
        Body: {
            version: number;
            intervals: Interval[];
        };
    }>('/work-profile/availability', { schema: { body: availabilitySchema } }, async (req, reply) => run(reply, () => repository!.replaceAvailability(scope(req).userId, req.body.intervals, req.body.version)));
}
