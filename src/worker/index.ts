import { loadConfig } from '../shared/config.js';

// Valida as variáveis já na inicialização (falha rápido se faltar algo)
const config = loadConfig();

// Placeholder: o loop de consumo do SQS é implementado na etapa 6.
console.log(`worker iniciado, fila: ${config.sqs.queueUrl}`);

setInterval(() => {}, 60_000);
