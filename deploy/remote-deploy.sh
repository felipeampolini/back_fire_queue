#!/usr/bin/env bash
# Roda na EC2 (como root): busca a configuração no SSM Parameter Store, gera o
# .env e a credencial do Firebase e (re)sobe os containers.
# Usado no primeiro boot (user-data.sh) e a cada deploy (make aws-deploy).
set -euo pipefail
cd "$(dirname "$0")/.."

PREFIX=/back-fire-queue

# Metadados da própria instância (IMDSv2: primeiro pede um token)
TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
meta() { curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"; }
AWS_REGION=$(meta placement/region)
export AWS_REGION
DOMAIN="$(meta public-ipv4 | tr . -).sslip.io"

# As credenciais da AWS vêm da IAM role da instância
param() { aws ssm get-parameter --name "$PREFIX/$1" --with-decryption --query Parameter.Value --output text; }

# Arquivos legíveis só pelo dono (os valores não aparecem em nenhum log)
umask 077
{
  param env
  echo "API_KEY=$(param api-key)"
  echo "DOMAIN=$DOMAIN"
} > .env
mkdir -p secrets
param firebase-sa > secrets/firebase-sa.json
# Os containers rodam como o usuário "node" (uid 1000), que precisa ler a credencial
chown -R 1000:1000 secrets
chmod 400 secrets/firebase-sa.json

docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null

echo "Deploy concluído: https://$DOMAIN"
