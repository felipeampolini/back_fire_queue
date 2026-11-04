#!/bin/bash
# Roda uma única vez, como root, no primeiro boot da EC2 (passado pelo aws-setup.sh).
# Log no servidor: /var/log/cloud-init-output.log
set -euo pipefail

# Docker, com os plugins Compose e Buildx (não vêm nos pacotes do Amazon Linux)
dnf install -y docker git
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-buildx \
  https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-amd64
chmod +x /usr/local/lib/docker/cli-plugins/*
systemctl enable --now docker

# Swap de 2 GB: a t3.micro tem 1 GB de RAM, pouco para gerar a imagem
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap defaults 0 0' >> /etc/fstab

git clone https://github.com/felipeampolini/back_fire_queue.git /opt/back_fire_queue
/opt/back_fire_queue/deploy/remote-deploy.sh
