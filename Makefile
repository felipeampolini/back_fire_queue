# Atalhos: todos os comandos rodam dentro do container (não é preciso Node na máquina).
RUN = docker compose run --rm --no-deps api

.PHONY: up down logs install npm sh lint format typecheck build

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

build: ## Gera a imagem de produção
	docker build --target prod -t back-fire-queue .
