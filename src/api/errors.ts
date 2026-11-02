import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { z } from 'zod';

// Formato único de erro em todas as respostas da API
export const errorResponseSchema = z.object({
  error: z.string(),
  details: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional()
    .describe('Presente em erros de validação (400): o que está errado em cada campo'),
});

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply.code(400).send({
      error: 'Pedido inválido',
      details: error.validation.map((issue) => ({
        path: issue.instancePath,
        message: issue.message,
      })),
    });
  }

  // Demais erros: o Fastify já trata (ex.: JSON malformado vira 400)
  throw error;
}
