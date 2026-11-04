#!/usr/bin/env bash
# Apaga tudo o que o aws-setup.sh criou: servidor, firewall, permissões, filas
# (com as mensagens) e parâmetros. Depois disso, nada mais consome créditos.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

ACCOUNT_ID=$(account_id)
read -r -p "Apagar todos os recursos do $APP na conta $ACCOUNT_ID ($AWS_REGION)? Digite 'apagar': " answer
[ "$answer" = apagar ] || { echo "Cancelado"; exit 1; }

step "Servidor"
INSTANCE_IDS=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$APP" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$INSTANCE_IDS" ]; then
  # shellcheck disable=SC2086 # lista de IDs separados por espaço
  aws ec2 terminate-instances --instance-ids $INSTANCE_IDS >/dev/null
  echo "Aguardando o desligamento de $INSTANCE_IDS..."
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --instance-ids $INSTANCE_IDS
fi

step "Firewall"
SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$APP" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG_ID" != None ]; then
  aws ec2 delete-security-group --group-id "$SG_ID"
fi

step "Permissões"
# "|| true": se já foi apagado numa execução anterior, segue em frente
aws iam remove-role-from-instance-profile --instance-profile-name "$ROLE_NAME" --role-name "$ROLE_NAME" 2>/dev/null || true
aws iam delete-instance-profile --instance-profile-name "$ROLE_NAME" 2>/dev/null || true
aws iam detach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null || true
aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$APP-app" 2>/dev/null || true
aws iam delete-role --role-name "$ROLE_NAME" 2>/dev/null || true

step "Filas"
for queue in "$QUEUE_NAME" "$DLQ_NAME"; do
  if url=$(aws sqs get-queue-url --queue-name "$queue" --query QueueUrl --output text 2>/dev/null); then
    aws sqs delete-queue --queue-url "$url"
  fi
done

step "Parâmetros"
aws ssm delete-parameters \
  --names "$PARAM_PREFIX/env" "$PARAM_PREFIX/api-key" "$PARAM_PREFIX/firebase-sa" >/dev/null

step "Tudo apagado"
