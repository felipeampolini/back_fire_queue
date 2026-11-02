# Atalhos: todos os comandos rodam dentro do container (não é preciso Node na máquina).
RUN = docker compose run --rm --no-deps api
# AWS CLI apontando para o ElasticMQ, dentro da rede do docker-compose
AWS = docker run --rm --network back_fire_queue_default \
	-e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local -e AWS_DEFAULT_REGION=us-east-1 \
	amazon/aws-cli --endpoint-url http://elasticmq:9324
QUEUE_ATTRS = ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible

.PHONY: up down logs install npm sh lint format typecheck test test-watch build queues postman api-key fcm-check

up: ## Sobe ElasticMQ, API e worker
	docker compose up --build

down: ## Para e remove os containers
	docker compose down

logs: ## Acompanha os logs (ex.: make logs s=worker)
	docker compose logs -f $(s)

install: ## Instala as dependências (gera node_modules na pasta do projeto)
	$(RUN) npm install

npm: ## Roda qualquer comando npm (ex.: make npm c="install zod")
	$(RUN) npm $(c)

sh: ## Abre um shell dentro do container
	$(RUN) sh

lint:
	$(RUN) npm run lint

format:
	$(RUN) npm run format

typecheck:
	$(RUN) npm run typecheck

test: ## Roda os testes uma vez (sobe o ElasticMQ para os testes de integração)
	docker compose run --rm api npm test

test-watch: ## Roda os testes e repete a cada alteração
	docker compose run --rm api npm run test:watch

build: ## Gera a imagem de produção
	docker build --target prod -t back-fire-queue .

api-key: ## Gera uma API key aleatória (48 caracteres hex) para colocar em API_KEY no .env
	@docker run --rm node:24-alpine node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"

fcm-check: ## Valida a credencial do Firebase (envio em dry run, nada é entregue)
	docker compose run --rm --no-deps worker npm run -s fcm:check

queues: ## Mostra quantas mensagens há na fila principal e na DLQ
	@for q in notifications-queue notifications-dlq; do \
		echo "== $$q"; \
		$(AWS) sqs get-queue-attributes --queue-url http://elasticmq:9324/000000000000/$$q \
			--attribute-names $(QUEUE_ATTRS) --output table --query Attributes; \
	done

postman: ## Roda a collection do Postman contra a API (precisa do `make up` rodando)
	@set -a; . ./.env; set +a; \
	docker run --rm --network back_fire_queue_default -v "$(CURDIR)/docs/postman:/etc/newman" \
		postman/newman:6-alpine run back_fire_queue.postman_collection.json \
		-e local.postman_environment.json --env-var baseUrl=http://api:3000 --env-var "apiKey=$$API_KEY"
