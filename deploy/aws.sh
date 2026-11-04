#!/usr/bin/env bash
# Comandos do dia a dia com o servidor na AWS. Os comandos remotos usam o
# SSM Run Command: não é preciso SSH nem porta 22 aberta.
#   deploy/aws.sh status | url | api-key | deploy | logs [serviço] | ps | dlq | dlq-redrive | run '<comando>'
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

COMPOSE="docker compose -f docker-compose.prod.yml"

require_instance() {
  INSTANCE_ID=$(instance_id)
  [ "$INSTANCE_ID" != None ] || { echo "Nenhum servidor ligado (crie com: make aws-setup)"; exit 1; }
}

# Executa um comando na pasta do projeto, na EC2, e mostra a saída
run() {
  require_instance
  local cmd="cd $REMOTE_DIR && $1" command_id status
  cmd=${cmd//\\/\\\\}
  cmd=${cmd//\"/\\\"}
  command_id=$(aws ssm send-command --instance-ids "$INSTANCE_ID" \
    --document-name AWS-RunShellScript --parameters "{\"commands\":[\"$cmd\"]}" \
    --query Command.CommandId --output text)
  while true; do
    sleep 3
    status=$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
      --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in Pending | InProgress | Delayed) ;; *) break ;; esac
  done
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
    --query '[StandardOutputContent, StandardErrorContent]' --output text
  [ "$status" = Success ] || { echo "Status: $status"; exit 1; }
}

case "${1:-}" in
  url)
    require_instance
    public_url "$INSTANCE_ID"
    ;;
  status)
    require_instance
    url=$(public_url "$INSTANCE_ID")
    echo "$url"
    if curl -fsS --max-time 10 "$url/health"; then
      echo
    else
      echo "Ainda não respondeu. No primeiro boot leva ~5 min; para ver o andamento:"
      echo "  make aws-run c='tail -n 30 /var/log/cloud-init-output.log'"
    fi
    ;;
  api-key)
    aws ssm get-parameter --name "$PARAM_PREFIX/api-key" --with-decryption \
      --query Parameter.Value --output text
    ;;
  deploy) run "git pull --ff-only && deploy/remote-deploy.sh" ;;
  logs) run "$COMPOSE logs --tail 100 ${2:-}" ;;
  ps) run "$COMPOSE ps" ;;
  dlq) run "$COMPOSE run --rm worker node dist/scripts/dlq.js list" ;;
  dlq-redrive) run "$COMPOSE run --rm worker node dist/scripts/dlq.js redrive" ;;
  run) run "${2:?informe o comando}" ;;
  *)
    sed -n '2,4p' "$0"
    exit 1
    ;;
esac
