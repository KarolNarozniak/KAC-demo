import type { FastifyInstance } from 'fastify';
import type { BlockInput } from '../../contracts.js';

export async function blockRoutes(app: FastifyInstance) {
  app.get('/blocks', async (request, reply) => {
    if (!app.repository?.listBlocks) {
      return reply.code(501).send({ error: 'Not implemented' });
    }
    return await app.repository.listBlocks();
  });

  app.post<{ Body: BlockInput }>('/blocks', async (request, reply) => {
    if (!app.repository?.createBlock) {
      return reply.code(501).send({ error: 'Not implemented' });
    }
    const block = await app.repository.createBlock(request.body);
    return reply.code(201).send(block);
  });

  app.delete<{ Params: { id: string } }>('/blocks/:id', async (request, reply) => {
    if (!app.repository?.deleteBlock) {
      return reply.code(501).send({ error: 'Not implemented' });
    }
    const success = await app.repository.deleteBlock(request.params.id);
    if (!success) {
      return reply.code(404).send({ error: 'Block not found' });
    }
    return { success: true };
  });
}