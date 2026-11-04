# shellcheck shell=bash disable=SC2034 # variáveis usadas pelos scripts que importam este arquivo
# Configuração e funções compartilhadas pelos scripts de deploy (rodam na sua máquina).

APP=back-fire-queue
AWS_PROFILE=${AWS_PROFILE:-back-fire-queue}
# Região liberada para o projeto pela política da organização (as demais são bloqueadas)
AWS_REGION=${AWS_REGION:-us-east-2}
QUEUE_NAME=notifications-queue
DLQ_NAME=notifications-dlq
PARAM_PREFIX=/back-fire-queue
ROLE_NAME=back-fire-queue-ec2
INSTANCE_TYPE=t3.micro
REMOTE_DIR=/opt/back_fire_queue

# AWS CLI via Docker (não precisa instalar). A pasta do projeto fica em /aws
# dentro do container, para os parâmetros file://.
aws() {
  docker run --rm -v "$HOME/.aws:/root/.aws:ro" -v "$PWD:/aws" \
    -e AWS_PROFILE="$AWS_PROFILE" -e AWS_REGION="$AWS_REGION" \
    amazon/aws-cli "$@"
}

step() { printf '\n==> %s\n' "$*"; }

account_id() { aws sts get-caller-identity --query Account --output text; }

# Instância ligada (ou ligando) com a tag Name=back-fire-queue; "None" se não houver
instance_id() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$APP" Name=instance-state-name,Values=pending,running \
    --query 'Reservations[0].Instances[0].InstanceId' --output text
}

# URL pública: o sslip.io resolve 3-90-12-34.sslip.io para o IP 3.90.12.34,
# o que dá um domínio (necessário para o certificado HTTPS) sem registrar nenhum
public_url() {
  local ip
  ip=$(aws ec2 describe-instances --instance-ids "$1" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
  echo "https://${ip//./-}.sslip.io"
}
