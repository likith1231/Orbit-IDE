#!/usr/bin/env bash
# One-time setup for an Oracle Cloud Ubuntu VM (works on other Ubuntu/Debian hosts too).
# Usage:  sudo bash deploy/setup-oracle.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo"; exit 1; fi

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
# Let the login user run docker without sudo (takes effect on next login).
if [ -n "${SUDO_USER:-}" ]; then usermod -aG docker "$SUDO_USER"; fi

echo "==> Opening ports 80 and 443 in the VM firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything except SSH,
# even after you open ports in the cloud console. Insert ACCEPT rules before the REJECT.
apt-get install -y iptables-persistent >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done

netfilter-persistent save

echo "==> Blocking cloud metadata access from user containers"
# Code users run in terminals/sandboxes must not be able to read instance metadata/credentials.
# Applied by a unit that runs after Docker (Docker owns the DOCKER-USER chain).
cat > /etc/systemd/system/orbit-block-metadata.service <<'UNIT'
[Unit]
Description=Block container access to the cloud metadata service
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d 169.254.169.254 -j REJECT 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254 -j REJECT'

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now orbit-block-metadata.service

echo "==> Creating data directories"
mkdir -p /var/lib/orbit
# Sites for other apps on this VM, served by the same Caddy (see deploy/Caddyfile).
mkdir -p /etc/caddy-sites

echo
echo "Done. Next steps (see docs/DEPLOY_ORACLE.md):"
echo "  1. cp deploy/.env.example .env && nano .env"
echo "  2. docker compose up -d --build"
