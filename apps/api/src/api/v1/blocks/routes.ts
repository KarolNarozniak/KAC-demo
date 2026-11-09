import type { FastifyInstance } from 'fastify';
import type { BlockInput } from '../../contracts.js';
import { PostgresCalendarRepository } from '../../../database.js';

declare module 'fastify' {
  interface FastifyInstance {
    repository: PostgresCalendarRepository;
  }
}

export async function blockRoutes(app: FastifyInstance) {
  app.get('/blocks', {
    schema: {
      tags: ['Blocks'],
      summary: 'List blocks and exam sessions',
      description: 'Retrieves all defined periods of unavailability such as vacations, exam sessions, and days off.',
      operationId: 'listBlocks',
      response: {
        200: {
          description: 'List of blocks and exam sessions',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    userId: { type: 'string' },
                    title: { type: 'string' },
                    startTime: { type: 'string' },
                    endTime: { type: 'string' },
                    type: { type: 'string', enum: ['vacation', 'exam_session', 'day_off'] }
                  }
                }
              }
            }
          }
        },
        501: {
          description: 'Not implemented',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    if (!app.repository?.listBlocks) {
      return reply.code(501).send({ error: 'Not implemented' });
    }
    return await app.repository.listBlocks();
  });

  app.post<{ Body: BlockInput }>('/blocks', {
    schema: {
      tags: ['Blocks'],
      summary: 'Create a block or exam session',
      description: 'Creates a new unavailability period (vacation, exam session, or day off) for scheduling calculations.',
      operationId: 'createBlock',
      body: {
        type: 'object',
        required: ['title', 'startTime', 'endTime', 'type'],
        properties: {
          title: { type: 'string' },
          startTime: { type: 'string' },
          endTime: { type: 'string' },
          type: { type: 'string', enum: ['vacation', 'exam_session', 'day_off'] }
        }
      },
      response: {
        201: {
          description: 'Created block or exam session',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  userId: { type: 'string' },
                  title: { type: 'string' },
                  startTime: { type: 'string' },
                  endTime: { type: 'string' },
                  type: { type: 'string', enum: ['vacation', 'exam_session', 'day_off'] }
                }
              }
            }
          }
        },
        501: {
          description: 'Not implemented',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    if (!app.repository?.createBlock) {
      return reply.code(501).send({ error: 'Not implemented' });
    }
    const block = await app.repository.createBlock(request.body);
    return reply.code(201).send(block);
  });

  app.delete<{ Params: { id: string } }>('/blocks/:id', {
    schema: {
      tags: ['Blocks'],
      summary: 'Delete a block or exam session',
      description: 'Removes an existing block or exam session by its unique identifier.',
      operationId: 'deleteBlock',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      },
      response: {
        200: {
          description: 'Deletion success confirmation',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' }
                }
              }
            }
          }
        },
        404: {
          description: 'Block not found',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' }
                }
              }
            }
          }
        },
        501: {
          description: 'Not implemented',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
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