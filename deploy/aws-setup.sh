#!/usr/bin/env bash
# Cria na AWS tudo o que o projeto precisa e liga o servidor:
#   1. filas SQS (principal + DLQ)
#   2. configuração e segredos no SSM Parameter Store
#   3. IAM role da EC2 (permissões mínimas: as duas filas e os parâmetros)
#   4. security group (firewall: só 80 e 443 abertos)
#   5. instância EC2, que se configura sozinha no primeiro boot (deploy/user-data.sh)
# Pode ser rodado de novo: o que já existe é reaproveitado.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/lib.sh

[ -f secrets/firebase-sa.json ] || { echo "Falta secrets/firebase-sa.json"; exit 1; }
[ -f .env ] || { echo "Falta o .env (de onde vêm as variáveis FIREBASE_WEB_*)"; exit 1; }

ACCOUNT_ID=$(account_id)
step "Conta $ACCOUNT_ID, região $AWS_REGION"

# ---------- 1. Filas ----------
# Mesmos parâmetros do elasticmq.conf usado em desenvolvimento
step "Filas SQS"
DLQ_URL=$(aws sqs create-queue --queue-name "$DLQ_NAME" \
  --attributes MessageRetentionPeriod=1209600 \
  --query QueueUrl --output text)
DLQ_ARN="arn:aws:sqs:$AWS_REGION:$ACCOUNT_ID:$DLQ_NAME"
QUEUE_ARN="arn:aws:sqs:$AWS_REGION:$ACCOUNT_ID:$QUEUE_NAME"
QUEUE_ATTRS=$(printf '{"VisibilityTimeout":"30","ReceiveMessageWaitTimeSeconds":"20","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}"}' "$DLQ_ARN")
QUEUE_URL=$(aws sqs create-queue --queue-name "$QUEUE_NAME" \
  --attributes "$QUEUE_ATTRS" \
  --query QueueUrl --output text)
echo "$QUEUE_URL"
echo "$DLQ_URL"

# ---------- 2. Configuração e segredos ----------
step "Configuração no SSM Parameter Store"
# Variáveis que não são segredo (os valores FIREBASE_WEB_* são públicos)
web() { grep -E "^$1=" .env | cut -d= -f2-; }
APP_ENV=$(cat <<EOF
PORT=3000
LOG_LEVEL=info
AWS_REGION=$AWS_REGION
SQS_QUEUE_URL=$QUEUE_URL
SQS_DLQ_URL=$DLQ_URL
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/firebase-sa.json
FCM_DRY_RUN=false
WORKER_BATCH_SIZE=10
WORKER_MAX_ATTEMPTS=5
FIREBASE_WEB_API_KEY=$(web FIREBASE_WEB_API_KEY)
FIREBASE_WEB_PROJECT_ID=$(web FIREBASE_WEB_PROJECT_ID)
FIREBASE_WEB_MESSAGING_SENDER_ID=$(web FIREBASE_WEB_MESSAGING_SENDER_ID)
FIREBASE_WEB_APP_ID=$(web FIREBASE_WEB_APP_ID)
FIREBASE_WEB_VAPID_KEY=$(web FIREBASE_WEB_VAPID_KEY)
EOF
)
aws ssm put-parameter --name "$PARAM_PREFIX/env" --type String --overwrite \
  --value "$APP_ENV" >/dev/null
echo "$PARAM_PREFIX/env"

# Segredos: SecureString (criptografados com KMS)
aws ssm put-parameter --name "$PARAM_PREFIX/firebase-sa" --type SecureString --overwrite \
  --value file:///aws/secrets/firebase-sa.json >/dev/null
echo "$PARAM_PREFIX/firebase-sa"
# A API key de produção é gerada uma única vez (diferente da de desenvolvimento)
if ! aws ssm get-parameter --name "$PARAM_PREFIX/api-key" >/dev/null 2>&1; then
  aws ssm put-parameter --name "$PARAM_PREFIX/api-key" --type SecureString \
    --value "$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')" >/dev/null
fi
echo "$PARAM_PREFIX/api-key (veja com: make aws-api-key)"

# ---------- 3. Permissões ----------
# A EC2 recebe credenciais temporárias por esta role: nenhuma chave de acesso
# fica gravada no servidor.
step "Permissões (IAM role da EC2)"
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }' >/dev/null
  # Permite acessar o servidor pelo Session Manager (sem SSH e sem porta 22 aberta)
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
fi
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$APP-app" --policy-document "$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Filas",
      "Effect": "Allow",
      "Action": ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      "Resource": ["$QUEUE_ARN", "$DLQ_ARN"]
    },
    {
      "Sid": "Configuracao",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter$PARAM_PREFIX/*"
    }
  ]
}
EOF
)"
if ! aws iam get-instance-profile --instance-profile-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$ROLE_NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE_NAME" --role-name "$ROLE_NAME"
fi
echo "$ROLE_NAME"

# ---------- 4. Firewall ----------
step "Firewall (security group)"
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$APP" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG_ID" = None ]; then
  SG_ID=$(aws ec2 create-security-group --group-name "$APP" --vpc-id "$VPC_ID" \
    --description "HTTP e HTTPS publicos" --query GroupId --output text)
  for port in 80 443; do
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
      --protocol tcp --port "$port" --cidr 0.0.0.0/0 >/dev/null
  done
fi
echo "$SG_ID (portas 80 e 443)"

# ---------- 5. Servidor ----------
step "Servidor (EC2 $INSTANCE_TYPE)"
INSTANCE_ID=$(instance_id)
if [ "$INSTANCE_ID" = None ]; then
  # Imagem mais recente do Amazon Linux 2023, publicada pela própria AWS
  AMI_ID=$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query Parameter.Value --output text)
  run_instance() {
    aws ec2 run-instances \
      --image-id "$AMI_ID" \
      --instance-type "$INSTANCE_TYPE" \
      --iam-instance-profile "Name=$ROLE_NAME" \
      --security-group-ids "$SG_ID" \
      --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled \
      --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=12,VolumeType=gp3}' \
      --user-data file:///aws/deploy/user-data.sh \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$APP}]" \
      --query 'Instances[0].InstanceId' --output text
  }
  # Uma role recém-criada leva alguns segundos para ser reconhecida pela EC2
  for attempt in 1 2 3 4 5 6; do
    INSTANCE_ID=$(run_instance) && break
    [ "$attempt" = 6 ] && exit 1
    echo "Tentando de novo em 10 s (a permissão recém-criada ainda está propagando)..."
    sleep 10
  done
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  echo "$INSTANCE_ID criada"
else
  echo "$INSTANCE_ID já existe (para atualizar o código: make aws-deploy)"
fi

step "Pronto"
echo "URL: $(public_url "$INSTANCE_ID")"
echo "Na primeira vez, o servidor leva ~5 minutos para instalar o Docker e subir a aplicação."
echo "Acompanhe com: make aws-status"
