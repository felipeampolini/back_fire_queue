# back_fire_queue

Fila de envio de notificações Firebase (FCM) com Node.js e AWS SQS.

A API recebe pedidos de notificação, valida e publica numa fila SQS, respondendo imediatamente (`202 Accepted`). Um worker consome a fila e envia as notificações para o Firebase, com retentativas, backoff exponencial e fila de mensagens mortas (DLQ).

## Sumário

- [Demonstração na AWS](#demonstração-na-aws)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Rodando localmente (passo a passo)](#rodando-localmente-passo-a-passo)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [API](#api)
- [Como o worker processa a fila](#como-o-worker-processa-a-fila)
- [DLQ](#dlq-mensagens-que-esgotaram-as-tentativas)
- [Firebase](#firebase)
- [Página de teste](#página-de-teste-receber-notificações-no-navegador)
- [Testes](#testes)
- [Deploy na AWS](#deploy-na-aws)
- [Decisões técnicas](#decisões-técnicas)
- [Comandos](#comandos)

## Demonstração na AWS

| Endereço                                        | O que é                                  |
| ----------------------------------------------- | ---------------------------------------- |
| [`/docs`](https://3-17-5-149.sslip.io/docs)     | Swagger UI (documentação interativa)     |
| [`/test/`](https://3-17-5-149.sslip.io/test/)   | Página para receber notificações         |
| [`/health`](https://3-17-5-149.sslip.io/health) | Health check                             |
| [`docs/postman/`](docs/postman)                 | Collection + environment `AWS` e `local` |

O `POST /notifications` exige a API key de produção, que não é publicada no repositório.

## Arquitetura

```
                       ┌──────────────┐  SendMessage  ┌──────────────────────┐
 Cliente ── HTTPS ───► │     API      │ ────────────► │ SQS                  │
 (POST /notifications) │  (Fastify)   │               │ notifications-queue  │
        ◄── 202 {id} ──│ valida (Zod) │               └──────────┬───────────┘
                       └──────────────┘                          │ ReceiveMessage
                                                                 ▼ (long polling)
                       ┌──────────────┐    envia     ┌──────────────────────┐
 Dispositivo ◄──────── │   Firebase   │ ◄─────────── │       Worker         │
 (Android, iOS, Web)   │     FCM      │              │ retentativa/backoff  │
                       └──────────────┘              └──────────┬───────────┘
                                                                 │ esgotou / inválida
                                                                 ▼
                                                     ┌──────────────────────┐
                                                     │ SQS notifications-dlq│
                                                     └──────────────────────┘
```

1. A API valida o pedido, gera um `id` e publica a mensagem na fila. Responde `202` sem esperar o envio: o cliente não fica preso à latência ou à instabilidade do Firebase.
2. O worker lê a fila em lotes, envia ao FCM e decide, pelo código de erro, se remove, reenfileira com atraso ou manda para a DLQ.
3. API e worker são processos independentes, com a mesma imagem Docker: escalam e falham separadamente. Se o worker parar, as mensagens esperam na fila; nada se perde.

## Stack

| Camada       | Tecnologia                                                                  |
| ------------ | --------------------------------------------------------------------------- |
| Runtime      | Node.js 24, TypeScript (ESM)                                                |
| API          | Fastify 5, Zod 4 (validação e tipos), Swagger/OpenAPI 3.1                   |
| Fila         | AWS SQS (`@aws-sdk/client-sqs`); ElasticMQ como emulador em desenvolvimento |
| Notificações | Firebase Admin SDK (FCM)                                                    |
| Logs         | pino (JSON estruturado)                                                     |
| Testes       | Vitest (unitários e de integração), Postman/Newman                          |
| Infra        | Docker, Docker Compose, AWS EC2, IAM, SSM Parameter Store, Caddy (HTTPS)    |

## Estrutura do projeto

```
src/
  api/                 # API HTTP
    app.ts             #   monta o Fastify (rotas, Swagger, tratamento de erros)
    server.ts          #   ponto de entrada: config, SQS, listen, encerramento limpo
    errors.ts          #   formato padrão das respostas de erro
    routes/
      notifications.ts #   POST /notifications (API key + validação + publicação)
      test-page.ts     #   página de teste e service worker do Firebase
  worker/              # Consumidor da fila
    index.ts           #   ponto de entrada
    worker.ts          #   laço de leitura e decisão (remover, reenfileirar, DLQ)
    queue.ts           #   operações no SQS (receber, apagar, reenfileirar, DLQ)
    fcm.ts             #   conversão para o formato do FCM e envio
    classify.ts        #   erros do FCM: definitivos x temporários
  shared/              # Usado pelos dois
    config.ts          #   variáveis de ambiente validadas com Zod
    notification.ts    #   contrato da notificação (schema + tipos)
    sqs.ts, logger.ts
  scripts/             # dlq.ts (listar/reprocessar DLQ), fcm-check.ts
public/test/           # Página de teste (HTML/JS estático)
tests/                 # Vitest: api/, shared/, worker/, integration/
deploy/                # Scripts de deploy na AWS
docs/postman/          # Collection e environments do Postman
```

## Rodando localmente (passo a passo)

Tudo roda em containers: **não é preciso ter Node.js instalado**.

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) com Docker Compose v2 (`docker compose version`)
- `git` e `make`
- No Windows: rodar dentro do WSL 2, com a integração do Docker Desktop habilitada para a distribuição
- Para enviar notificações de verdade: um projeto no [Firebase](https://console.firebase.google.com/) (ver [Firebase](#firebase))

### 1. Clonar

```bash
git clone https://github.com/felipeampolini/back_fire_queue.git
cd back_fire_queue
```

### 2. Criar o `.env`

```bash
cp .env.example .env
```

Preencha com os valores abaixo (desenvolvimento local com ElasticMQ). Comentários devem ficar em linhas próprias: no `.env`, um `# ...` depois de um valor vazio é lido como o próprio valor.

```dotenv
PORT=3000
# Gere com: make api-key (passo 3)
API_KEY=
# Porta no seu computador; troque se a 3000 estiver ocupada
API_HOST_PORT=3000
LOG_LEVEL=info

AWS_REGION=us-east-1
AWS_ENDPOINT_URL=http://elasticmq:9324
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
SQS_QUEUE_URL=http://elasticmq:9324/000000000000/notifications-queue
SQS_DLQ_URL=http://elasticmq:9324/000000000000/notifications-dlq

# Opcionais: só para a página de teste (/test/)
FIREBASE_WEB_API_KEY=
FIREBASE_WEB_PROJECT_ID=
FIREBASE_WEB_MESSAGING_SENDER_ID=
FIREBASE_WEB_APP_ID=
FIREBASE_WEB_VAPID_KEY=

# Credencial do Firebase (worker). Deixe vazio se ainda não tiver.
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/firebase-sa.json
FCM_DRY_RUN=false

WORKER_BATCH_SIZE=10
WORKER_MAX_ATTEMPTS=5
```

### 3. Gerar a API key

```bash
make api-key
# exemplo de saída: 0123456789abcdef0123456789abcdef0123456789abcdef
```

Copie o valor gerado para `API_KEY` no `.env`.

### 4. Credencial do Firebase

Salve o JSON da Service Account em `secrets/firebase-sa.json` (passo a passo em [Firebase](#firebase)).

Sem a credencial, deixe `GOOGLE_APPLICATION_CREDENTIALS` vazio: a API e a fila funcionam normalmente, e o worker encerra com uma mensagem explicando o que falta. As notificações ficam esperando na fila até ele subir.

### 5. Instalar as dependências

```bash
make install
```

Em desenvolvimento, a pasta do projeto é montada dentro do container (para recarregar o código a cada alteração). Por isso o `node_modules` é criado na própria pasta, por este comando, **antes** do primeiro `make up`.

### 6. Subir

```bash
make up
```

Sobe três containers: `elasticmq` (emulador do SQS, já com a fila e a DLQ), `api` e `worker`. Os logs aparecem no terminal; `Ctrl+C` para parar (ou `make down` em outro terminal).

### 7. Verificar

Em outro terminal (troque `3000` se mudou `API_HOST_PORT`):

```bash
curl http://localhost:3000/health
# {"status":"ok"}

curl -X POST http://localhost:3000/notifications \
  -H 'content-type: application/json' \
  -H "x-api-key: $(grep ^API_KEY= .env | cut -d= -f2)" \
  -d '{"target":{"type":"topic","value":"novidades"},"notification":{"title":"Olá","body":"Primeira notificação"}}'
# {"id":"..."}

make logs s=worker   # "notificação processada"
make queues          # quantidade de mensagens na fila e na DLQ
```

| Endereço                          | O que é                         |
| --------------------------------- | ------------------------------- |
| `http://localhost:3000/health`    | Health check                    |
| `http://localhost:3000/docs`      | Swagger UI (documentação)       |
| `http://localhost:3000/docs/json` | Especificação OpenAPI 3.1       |
| `http://localhost:3000/test/`     | Página de teste de notificações |

### Problemas comuns

| Sintoma                                                          | Causa e solução                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `env file .env not found`                                        | Falta o passo 2 (`cp .env.example .env`).                                                                                          |
| `Cannot find module` / `tsx: not found`                          | Falta o passo 5 (`make install`).                                                                                                  |
| `port is already allocated`                                      | A porta 3000 está em uso: mude `API_HOST_PORT` no `.env`.                                                                          |
| API ou worker encerram com `Variáveis de ambiente inválidas`     | Alguma variável está faltando ou com formato errado; a mensagem diz qual (ex.: `API_KEY` com menos de 16 caracteres).              |
| Worker encerra com `GOOGLE_APPLICATION_CREDENTIALS não definida` | Sem credencial do Firebase (passo 4). A API continua funcionando.                                                                  |
| Worker encerra ao ler a credencial                               | `GOOGLE_APPLICATION_CREDENTIALS` aponta para um arquivo inexistente: confira `secrets/firebase-sa.json` ou deixe a variável vazia. |
| `EACCES` no `make install` (Linux)                               | O container roda com o usuário de UID 1000. Se o seu usuário tiver outro UID, ajuste o dono da pasta: `sudo chown -R 1000 .`       |
| `Cannot connect to the Docker daemon`                            | O Docker não está rodando (no Windows, abra o Docker Desktop).                                                                     |

## Variáveis de ambiente

Validadas na inicialização (`src/shared/config.ts`): se algo estiver errado, o processo para com uma mensagem clara.

| Variável                           | Obrigatória | Padrão  | Descrição                                                                      |
| ---------------------------------- | ----------- | ------- | ------------------------------------------------------------------------------ |
| `PORT`                             | não         | `3000`  | Porta da API dentro do container                                               |
| `API_KEY`                          | sim         |         | Chave do header `x-api-key` (mínimo 16 caracteres)                             |
| `API_HOST_PORT`                    | não         | `3000`  | Porta no seu computador (só no `docker-compose.yml`)                           |
| `LOG_LEVEL`                        | não         | `info`  | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent`                 |
| `AWS_REGION`                       | sim         |         | Região da AWS                                                                  |
| `AWS_ENDPOINT_URL`                 | não         |         | Só em desenvolvimento (ElasticMQ). Vazia = SQS real                            |
| `AWS_ACCESS_KEY_ID` / `_SECRET_..` | não         |         | Só em desenvolvimento (qualquer valor). Na EC2, as credenciais vêm da IAM role |
| `SQS_QUEUE_URL`                    | sim         |         | URL da fila principal                                                          |
| `SQS_DLQ_URL`                      | sim         |         | URL da DLQ                                                                     |
| `GOOGLE_APPLICATION_CREDENTIALS`   | worker      |         | Caminho do JSON da Service Account, dentro do container                        |
| `FCM_DRY_RUN`                      | não         | `false` | `true` = o Firebase valida mas não entrega                                     |
| `FIREBASE_WEB_*` (5 variáveis)     | não         |         | Configuração da página de teste; ela só é publicada se todas existirem         |
| `WORKER_BATCH_SIZE`                | não         | `10`    | Mensagens lidas por vez (1 a 10)                                               |
| `WORKER_MAX_ATTEMPTS`              | não         | `5`     | Tentativas de envio antes da DLQ                                               |

## API

Documentação completa e interativa em `/docs` (Swagger). Resumo:

| Método | Rota             | Autenticação | Resposta                                                                |
| ------ | ---------------- | ------------ | ----------------------------------------------------------------------- |
| `POST` | `/notifications` | `x-api-key`  | `202 {id}` · `400` inválido · `401` sem chave · `503` fila indisponível |
| `GET`  | `/health`        | —            | `200 {"status":"ok"}`                                                   |
| `GET`  | `/docs`          | —            | Swagger UI                                                              |

### `POST /notifications`

```json
{
  "target": { "type": "token", "value": "<token do dispositivo>" },
  "notification": { "title": "Pedido enviado", "body": "Seu pedido saiu para entrega" },
  "data": { "orderId": "123" },
  "priority": "high",
  "ttlSeconds": 3600
}
```

| Campo                 | Regras                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `target`              | `{"type":"token","value":"..."}`, `{"type":"tokens","value":[...]}` (até 500) ou `{"type":"topic","value":"..."}` |
| `notification`        | `title` e `body`. Opcional, mas é preciso informar `notification` e/ou `data`                                     |
| `data`                | Objeto com valores **string** (exigência do FCM). Sem `notification`, vira mensagem silenciosa                    |
| `priority`            | `high` ou `normal` (padrão). Convertida para o formato de cada plataforma (Android, APNs, Web Push)               |
| `ttlSeconds`          | 0 a 28 dias: por quanto tempo o FCM tenta entregar a um dispositivo offline                                       |
| `notification`+`data` | No máximo 4 KB (limite do FCM)                                                                                    |

Erros seguem um formato único:

```json
{ "error": "Pedido inválido", "details": [{ "path": "/target/value", "message": "..." }] }
```

## Como o worker processa a fila

1. Lê até `WORKER_BATCH_SIZE` mensagens por vez, com _long polling_ (espera até 20 s por mensagens).
2. Processa o lote em paralelo e envia cada notificação ao Firebase.
3. Decide pelo código de erro de cada destino:

| Resultado                                                      | Ação                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Sucesso                                                        | Remove a mensagem da fila                                                                |
| Falha definitiva (token inválido/expirado, mensagem inválida)  | Registra no log e remove — tentar de novo não adianta                                    |
| Falha temporária (instabilidade do FCM, limite de envio, rede) | Reenfileira com atraso crescente (10 s, 20 s, 40 s...), só para os destinos que falharam |
| Tentativas esgotadas (`WORKER_MAX_ATTEMPTS`)                   | Envia para a DLQ com o motivo no atributo `reason`                                       |
| Mensagem fora do contrato                                      | Envia direto para a DLQ                                                                  |

A mensagem original só é removida depois que a nova (ou a da DLQ) foi gravada: se algo falhar no meio, o pior caso é uma notificação duplicada, nunca perdida. Se o worker cair durante o processamento, a mensagem volta a ficar visível após o _visibility timeout_ e é processada de novo.

Ao receber `SIGTERM`/`SIGINT`, o worker para de ler a fila e termina as mensagens em andamento antes de sair.

## DLQ (mensagens que esgotaram as tentativas)

Mensagens que falharam em todas as tentativas, ou que estão fora do contrato, vão para a DLQ com o motivo no atributo `reason`. Nada é descartado sem registro.

```bash
make dlq          # lista as mensagens da DLQ e o motivo de cada uma (não remove nada)
make dlq-redrive  # devolve todas para a fila principal, para nova tentativa
```

Fluxo típico: o Firebase ficou fora do ar (ou a credencial estava errada) → as mensagens esgotaram as tentativas e foram para a DLQ → depois de resolvido o problema, `make dlq-redrive` as reprocessa. Mensagens reprocessadas recomeçam a contagem de tentativas.

O redrive grava cada mensagem na fila principal antes de removê-la da DLQ (no pior caso, uma duplicata; nunca uma perda). Além do envio explícito pelo worker, a fila principal tem uma _redrive policy_ (5 recebimentos → DLQ) como rede de segurança, caso o worker trave sempre na mesma mensagem.

## Firebase

O worker envia as notificações com o [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup), autenticado por uma **Service Account**:

1. No [console do Firebase](https://console.firebase.google.com/), crie (ou abra) um projeto.
2. **Configurações do projeto → Contas de serviço → Gerar nova chave privada**.
3. Salve o arquivo em `secrets/firebase-sa.json` (a pasta `secrets/` é ignorada pelo git e pelo Docker).
4. No `.env`: `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/firebase-sa.json` (caminho dentro do container).

Para validar a credencial sem entregar nada a nenhum dispositivo:

```bash
make fcm-check
# Credencial do Firebase OK (dry run): projects/<seu-projeto>/messages/...
```

Com `FCM_DRY_RUN=true`, o worker envia todas as notificações em modo de validação: o Firebase confere a mensagem, mas não entrega.

Apenas o worker recebe a credencial: a API só publica na fila e não tem acesso ao Firebase.

## Página de teste (receber notificações no navegador)

Em `/test/` há uma página que recebe notificações do Firebase no próprio navegador — não é preciso ter um app mobile.

1. Abra `http://localhost:3000/test/` e clique em **Permitir e gerar token**.
2. Informe a API key, ajuste título e mensagem e clique em **Enviar**.
3. A notificação percorre o fluxo completo (API → SQS → worker → Firebase) e chega ao navegador: na lista da página, se ela estiver em foco, ou como notificação do sistema, se estiver em segundo plano.

Também funciona no celular, pela URL da AWS (HTTPS): no Android pelo Chrome; no iPhone (iOS 16.4+), adicionando a página à Tela de Início pelo Safari e abrindo pelo ícone.

Configuração: a página só é publicada quando todas as variáveis `FIREBASE_WEB_*` estão no `.env`. Os valores vêm do console do Firebase:

| Variável                                                                 | Onde encontrar                                                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `FIREBASE_WEB_API_KEY`, `_PROJECT_ID`, `_MESSAGING_SENDER_ID`, `_APP_ID` | **Configurações do projeto → Geral → Seus apps** (app Web): objeto `firebaseConfig`       |
| `FIREBASE_WEB_VAPID_KEY`                                                 | **Configurações do projeto → Cloud Messaging → Certificados push da Web** (chave pública) |

São valores públicos (identificam o projeto no navegador; não permitem enviar notificações). Notificações push exigem HTTPS ou `localhost`.

## Testes

```bash
make test      # testes automatizados: unitários e de integração (sobe o ElasticMQ junto)
make postman   # collection do Postman contra a API rodando (precisa do make up)
```

| Pasta                | O que cobre                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `tests/api/`         | Rotas via `app.inject()` (sem abrir porta): validação, API key, respostas de erro, página de teste |
| `tests/shared/`      | Configuração e contrato da notificação                                                             |
| `tests/worker/`      | Conversão para o FCM e todas as decisões do worker (com fila e Firebase falsos)                    |
| `tests/integration/` | Publicação e consumo contra o ElasticMQ real, incluindo o caminho até a DLQ                        |

### Postman

A collection fica em [`docs/postman/`](docs/postman):

| Arquivo                                   | Conteúdo                                                 |
| ----------------------------------------- | -------------------------------------------------------- |
| `back_fire_queue.postman_collection.json` | 15 requisições de sucesso e de erro, cada uma com testes |
| `local.postman_environment.json`          | Ambiente local (`baseUrl` = `http://localhost:3000`)     |
| `aws.postman_environment.json`            | Ambiente na AWS (`baseUrl` = URL pública)                |

1. No Postman, **Import** → selecione a collection e os environments.
2. Selecione o environment (**local** ou **AWS**) e preencha `apiKey`. Se mudou `API_HOST_PORT`, ajuste também o `baseUrl`.
3. Para receber uma notificação de verdade, troque `deviceToken` por um token real (a página `/test/` mostra o token do navegador).
4. Rode as requisições individualmente ou a collection inteira (**Run collection**).

| Pasta                          | Requisições                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Infra                          | Health check, especificação OpenAPI                                                                                                        |
| Notificações — sucesso (202)   | Para um token, vários tokens, tópico, mensagem silenciosa (só `data`), com TTL                                                             |
| Notificações — erros esperados | Sem API key, API key inválida, campos inválidos, sem conteúdo, tópico inválido, mais de 500 tokens, payload acima de 4 KB, JSON malformado |

## Deploy na AWS

Uma instância EC2 roda API, worker e [Caddy](https://caddyserver.com/) (HTTPS automático) com `docker-compose.prod.yml`, usando o SQS real.

```
Internet ──HTTPS──► Caddy ──► API ──► SQS ◄── worker ──► Firebase
                    └──────── EC2 (Docker Compose) ───────┘
```

- **Sem chaves de acesso no servidor:** a EC2 recebe credenciais temporárias por uma IAM role com permissão apenas para as duas filas e para os parâmetros do projeto.
- **Segredos no SSM Parameter Store:** a credencial do Firebase e a API key ficam criptografadas (SecureString); o servidor as busca a cada deploy e gera o `.env`.
- **Sem SSH:** nenhuma porta além de 80/443 fica aberta; os comandos remotos usam o SSM Run Command.
- **Domínio:** `<ip-com-hífens>.sslip.io`, que resolve para o IP da instância e permite emitir o certificado HTTPS sem registrar um domínio.

Pré-requisitos: AWS CLI configurado com o perfil `back-fire-queue` (`docker run --rm -it -v ~/.aws:/root/.aws amazon/aws-cli configure --profile back-fire-queue`), `.env` e `secrets/firebase-sa.json` preenchidos localmente. A região padrão é `us-east-2` (altere com `AWS_REGION=...`).

```bash
make aws-setup      # cria filas, parâmetros, permissões, firewall e a EC2 (o servidor se configura sozinho)
make aws-status     # URL pública e /health
make aws-api-key    # API key de produção
make aws-deploy     # atualiza o servidor com a branch main do GitHub
make aws-logs       # logs (s=api | s=worker | s=caddy)
make aws-dlq        # DLQ de produção (aws-dlq-redrive para reprocessar)
make aws-teardown   # apaga tudo
```

## Decisões técnicas

- **Fila entre a API e o Firebase.** A API responde em milissegundos, independentemente do Firebase; picos são absorvidos pela fila; falhas do FCM viram retentativas em vez de erros para o cliente.
- **Entrega _at-least-once_.** O SQS padrão pode entregar uma mensagem mais de uma vez, e o worker grava antes de apagar. Uma notificação duplicada é preferível a uma perdida; cada mensagem tem um `id` para quem precisar deduplicar.
- **Retentativa só do que falhou.** Num envio para vários tokens, apenas os tokens com erro temporário voltam para a fila, com backoff exponencial (10 s, 20 s, 40 s… até 15 min) via `DelaySeconds`.
- **Erros classificados.** Token inválido ou mensagem malformada não melhoram com nova tentativa: são registrados e descartados. Instabilidade, limite de envio e falha de autenticação são retentados e, se persistirem, vão para a DLQ com o motivo, prontos para reprocessar depois da correção.
- **Contrato único com Zod.** O mesmo schema valida a entrada da API, gera a documentação OpenAPI, tipa o código e valida a mensagem lida da fila pelo worker.
- **Injeção de dependências.** A API recebe um _publisher_ e o worker recebe _queue_ e _sender_ como interfaces: os testes trocam SQS e Firebase por implementações falsas, sem mocks de módulo.
- **Configuração pelo ambiente (12-factor).** O mesmo código roda com ElasticMQ e com SQS real; só as variáveis mudam.
- **Menor privilégio.** Só o worker tem a credencial do Firebase; a IAM role da EC2 acessa apenas as duas filas e os parâmetros do projeto.
- **Encerramento limpo.** API e worker tratam `SIGTERM`: param de aceitar trabalho novo e terminam o que está em andamento.

## Comandos

| Comando                                        | O que faz                                                      |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `make up` / `make down`                        | Sobe / derruba o ambiente local                                |
| `make logs s=worker`                           | Acompanha os logs de um serviço                                |
| `make install`                                 | Instala as dependências (dentro do container)                  |
| `make npm c="..."` / `make sh`                 | Roda um comando npm / abre um shell no container               |
| `make lint` / `make format` / `make typecheck` | Qualidade do código                                            |
| `make test` / `make test-watch`                | Testes automatizados                                           |
| `make postman`                                 | Collection do Postman contra a API local                       |
| `make queues`                                  | Mensagens na fila principal e na DLQ                           |
| `make dlq` / `make dlq-redrive`                | Lista a DLQ / devolve tudo à fila principal                    |
| `make api-key`                                 | Gera uma API key aleatória                                     |
| `make fcm-check`                               | Valida a credencial do Firebase (dry run)                      |
| `make build`                                   | Gera a imagem de produção                                      |
| `make aws-*`                                   | Deploy e operação na AWS (ver [Deploy na AWS](#deploy-na-aws)) |
