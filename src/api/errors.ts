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

  // Erros do cliente detectados pelo Fastify (ex.: JSON malformado): a mensagem explica o problema
  const statusCode = error.statusCode ?? 500;
  if (statusCode < 500) {
    return reply.code(statusCode).send({ error: error.message });
  }

  // Erro inesperado: registra o detalhe no log e não expõe nada interno ao cliente
  request.log.error({ err: error }, 'erro inesperado');
  return reply.code(500).send({ error: 'Erro interno' });
}
