import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Logs do Fastify só atrapalham a saída dos testes
    env: { LOG_LEVEL: 'silent' },
  },
});
