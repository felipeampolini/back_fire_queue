// Erros em que tentar de novo não adianta: o problema está no token ou na
// própria mensagem. Todo o resto (instabilidade do FCM, limite de envio,
// rede, credencial) é tratado como temporário.
//
// Credencial/configuração inválida (authentication-error, third-party-auth-error)
// fica de propósito como temporária: as mensagens esgotam as tentativas e vão
// para a DLQ, de onde podem ser reprocessadas depois que a configuração for
// corrigida — em vez de serem descartadas.
const PERMANENT_CODES = new Set([
  'messaging/registration-token-not-registered', // app desinstalado ou token expirado
  'messaging/invalid-registration-token', // token com formato inválido
  'messaging/installation-id-not-registered',
  'messaging/mismatched-credential', // token pertence a outro projeto Firebase
  'messaging/invalid-recipient',
  'messaging/invalid-argument',
  'messaging/invalid-payload',
  'messaging/invalid-data-payload-key',
  'messaging/invalid-options',
  'messaging/invalid-package-name',
  'messaging/payload-size-limit-exceeded',
]);

// Tokens que nunca mais vão funcionar: em produção, seriam removidos da base
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/installation-id-not-registered',
]);

export function isRetryable(code: string) {
  return !PERMANENT_CODES.has(code);
}

export function isDeadToken(code: string) {
  return DEAD_TOKEN_CODES.has(code);
}
