import { ProfileError } from '../../../profile/availability.js';
import type { FastifyInstance } from 'fastify';
import { validateWorkProfile } from '../../../profile/rules.js';
import type { WorkProfileRepository } from '../../../profile/repository.js';
import type { WorkProfileInput } from '../../../profile/types.js';
import { demoScope, type ScopeResolver } from '../../scope.js';
import { getWorkProfileRoute, updateWorkProfileRoute } from './schemas.js';

/**
 * Profil pracy (S23KC2S1P2-15) z celem godzin (S23KC2S1P2-39).
 * Użytkownika ustala serwer przez scope (S23KC2S1P2-185) – żądanie nie zawiera identyfikatora użytkownika.
 */
export async function profileRoutes(app: FastifyInstance, options: { repository?: WorkProfileRepository; scope?: ScopeResolver }) {
  const { repository } = options;
  const scope = options.scope ?? demoScope;

  app.get('/work-profile', { schema: getWorkProfileRoute }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'work_profile_not_configured' });
    try {
      const profile = await repository.getProfile(scope(request));
      return profile ?? reply.code(404).send({ error: 'work_profile_not_found' });
    } catch (error) {
      request.log.error({ err: error }, 'Work profile lookup failed');
      return reply.code(503).send({ error: 'work_profile_unavailable' });
    }
  });

  app.put<{ Body: WorkProfileInput }>('/work-profile', { schema: updateWorkProfileRoute }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'work_profile_not_configured' });
    try {
      const current=request.body.hourlyRatePln!=null&&!request.body.rateKind ? await repository.getProfile(scope(request)) : undefined;
      const checked = validateWorkProfile(request.body,current??undefined);
      if (!checked.ok) return reply.code(422).send({ error: 'invalid_work_profile', fields: checked.fields });
      const result = await repository.saveProfile(scope(request), request.body.profileVersion, checked.value);
      if (result.kind === 'not-found') return reply.code(404).send({ error: 'work_profile_not_found' });
      if (result.kind === 'conflict') return reply.code(409).send({ error: 'profile_version_conflict', profile: result.current });
      return result.profile;
    } catch (error) {
      if(error instanceof ProfileError)return reply.code(422).send({error:'invalid_work_profile',fields:{availability:'overlap'}});
      request.log.error({ err: error }, 'Work profile update failed');
      return reply.code(503).send({ error: 'work_profile_unavailable' });
    }
  });
}
