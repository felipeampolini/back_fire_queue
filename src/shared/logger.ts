import { pino } from 'pino';
import type { Config } from './config.js';

// Logs estruturados em JSON (mesmo formato dos logs do Fastify na API)
export function createLogger(level: Config['logLevel'], name: string) {
  return pino({ level, name });
}

export type Logger = ReturnType<typeof createLogger>;
