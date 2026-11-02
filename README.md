# back_fire_queue

Fila de envio de notificações Firebase (FCM) com Node.js e AWS SQS.

A API recebe pedidos de notificação, valida e publica numa fila SQS, respondendo imediatamente (`202 Accepted`). Um worker consome a fila e envia as notificações para o Firebase, com retentativas e fila de mensagens mortas (DLQ).

> Documentação completa em construção.

## Rodando localmente

Pré-requisito: Docker com Docker Compose.

```bash
cp .env.example .env   # preencha os valores
make up                # sobe ElasticMQ (emulador de SQS), API e worker
```

| Endereço                          | O que é                   |
| --------------------------------- | ------------------------- |
| `http://localhost:3000/health`    | Health check              |
| `http://localhost:3000/docs`      | Swagger UI (documentação) |
| `http://localhost:3000/docs/json` | Especificação OpenAPI 3.1 |

A porta pode ser alterada com `API_HOST_PORT` no `.env`.

## API key

O `POST /notifications` exige o header `x-api-key` com o valor da variável `API_KEY` (mínimo de 16 caracteres). As rotas `/health` e `/docs` são públicas.

Para gerar uma chave:

```bash
make api-key
# c78a4ca83235cd599d146b95765f469618d3bf52ed046a3e
```

Copie o valor para `API_KEY` no `.env` e reinicie a API (`make down && make up`). No Swagger, use o botão **Authorize**; no Postman, a variável `apiKey` do environment.

A chave é única por ambiente e nunca deve ser versionada.

## Firebase

O worker envia as notificações com o [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup), autenticado por uma **Service Account**:

1. No console do Firebase: **Configurações do projeto → Contas de serviço → Gerar nova chave privada**.
2. Salve o arquivo em `secrets/firebase-sa.json` (a pasta `secrets/` é ignorada pelo git e pelo Docker).
3. No `.env`: `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/firebase-sa.json` (caminho dentro do container).

Para validar a credencial sem entregar nada a nenhum dispositivo:

```bash
make fcm-check
# Credencial do Firebase OK (dry run): projects/<seu-projeto>/messages/...
```

Com `FCM_DRY_RUN=true`, o worker envia todas as notificações em modo de validação: o Firebase confere a mensagem, mas não entrega.

## Testes

```bash
make test      # testes automatizados (unitários e de integração)
make postman   # collection do Postman contra a API rodando
```

## Testes manuais com Postman

A collection fica em [`docs/postman/`](docs/postman):

| Arquivo                                   | Conteúdo                                               |
| ----------------------------------------- | ------------------------------------------------------ |
| `back_fire_queue.postman_collection.json` | Requisições de sucesso e de erro, cada uma com testes  |
| `local.postman_environment.json`          | Variáveis do ambiente local (`baseUrl`, `apiKey`, ...) |

Como usar:

1. No Postman, **Import** → selecione os dois arquivos.
2. Selecione o environment **back_fire_queue — local**.
3. Preencha a variável `apiKey` com o valor de `API_KEY` do seu `.env`.
4. Para receber uma notificação de verdade, troque `deviceToken` por um token real.
5. Rode as requisições individualmente ou a collection inteira (**Run collection**).

A autenticação (header `x-api-key`) é configurada uma vez na collection e herdada por todas as requisições.

| Pasta                          | Requisições                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Infra                          | Health check, especificação OpenAPI                                                                                                        |
| Notificações — sucesso (202)   | Para um token, vários tokens, tópico, mensagem silenciosa (só `data`), com TTL                                                             |
| Notificações — erros esperados | Sem API key, API key inválida, campos inválidos, sem conteúdo, tópico inválido, mais de 500 tokens, payload acima de 4 KB, JSON malformado |

Alternativa: o Postman também importa a API direto da especificação OpenAPI (**Import** → `http://localhost:3000/docs/json`).
