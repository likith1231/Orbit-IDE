# Deploying the backend to Oracle Cloud (Always Free)

This puts the Orbit IDE backend, Postgres and an HTTPS proxy on one Oracle VM. The frontend stays on Vercel.

```
Browser ──HTTPS──► Vercel (frontend)
   │
   └──HTTPS/WSS──► Oracle VM ─ Caddy :443 ─► backend 127.0.0.1:5000 ─► Postgres 127.0.0.1:5432
                                                   │
                                                   └─► Docker: terminal / sandbox / deploy containers
```

Total time: about 30 minutes. Cost: $0 on the Always Free tier.

---

## 1. Create the VM

1. Sign in to <https://cloud.oracle.com> → **Compute → Instances → Create instance**.
2. **Image:** Canonical Ubuntu 24.04 (or 22.04).
3. **Shape:** *Change shape* → **Ampere** → `VM.Standard.A1.Flex`. Pick **2–4 OCPUs and 12–24 GB RAM** (Always Free covers up to 4 OCPU / 24 GB total).
   - The free AMD "micro" shape only has 1 GB RAM. That's too small to compile code in containers.
   - If you see **"Out of capacity"**, try another *availability domain* or try again later. Upgrading the account to *Pay As You Go* (you still pay $0 for Always Free resources) usually makes A1 capacity much easier to get.
4. **Networking:** keep the default VCN with a **public IPv4 address**.
5. **SSH keys:** download the generated private key (or paste your own public key).
6. **Boot volume:** 100 GB is plenty (Always Free includes 200 GB total). Docker images for all languages take ~10 GB.
7. Create, then copy the instance's **Public IP address**.

## 2. Open ports 80 and 443 in Oracle's firewall

Instance page → **Primary VNIC → Subnet → Security List → Add Ingress Rules**:

| Source CIDR | IP Protocol | Destination port |
|-------------|-------------|------------------|
| `0.0.0.0/0` | TCP         | `80`             |
| `0.0.0.0/0` | TCP         | `443`            |

Do **not** open 5000 or 5432. The backend and database only listen on localhost.

## 3. Prepare the server

```bash
ssh -i ~/Downloads/ssh-key.key ubuntu@<PUBLIC_IP>

sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/likith1231/Orbit-IDE.git
cd Orbit-IDE
sudo bash deploy/setup-oracle.sh
```

The script installs Docker, opens 80/443 in the VM's own iptables (Oracle's Ubuntu images block them even after step 2), and stops user containers from reaching the cloud metadata service. Log out and back in afterwards so `docker` works without `sudo`.

## 4. Configure

```bash
cp deploy/.env.example .env
nano .env
```

| Variable | What to put |
|---|---|
| `DOMAIN` | Your API hostname. **No domain?** Use your IP with dashes + `.sslip.io`, e.g. `129-146-10-20.sslip.io`. It resolves to your IP and gets a real HTTPS certificate. |
| `POSTGRES_PASSWORD` | output of `openssl rand -hex 24` |
| `JWT_SECRET` | output of `openssl rand -hex 64` |
| `ANTHROPIC_API_KEY` | your key from <https://console.anthropic.com/settings/keys> |
| `CORS_ORIGINS` | your frontend URL, e.g. `https://orbit-ide-rho.vercel.app` |

## 5. Start everything

```bash
docker compose up -d --build
docker compose logs -f backend      # Ctrl+C to stop following
```

You should see `Docker: connected · Terminal: docker`. Check it from your laptop:

```bash
curl https://<DOMAIN>/api/health
# {"ok":true,"db":true,"docker":true,"terminal":"docker","ai":true}
```

The first HTTPS request can take ~20 s while Caddy obtains the certificate.

**Optional: pre-pull language images** so the first Run of each language is fast:

```bash
for i in node:20-alpine python:3.12-alpine eclipse-temurin:21-jdk-alpine gcc:13-bookworm \
         golang:1.22-alpine rust:1.78-slim ruby:3.3-alpine php:8.3-cli-alpine bash:5.2 \
         perl:5.38-slim akorn/lua:5.4-alpine mcr.microsoft.com/dotnet/sdk:8.0-alpine; do docker pull $i; done
```

## 6. Point the frontend at it

Vercel → your project → **Settings → Environment Variables**:

```
VITE_API_URL = https://<DOMAIN>
```

Then **Deployments → ⋯ → Redeploy**. Vite bakes env vars in at build time, so a redeploy is required.

## 7. Lock it down

Once you've signed up with your own account, stop strangers from creating accounts, running code on your VM and spending your Claude credits:

```bash
sed -i 's/^SIGNUP_ENABLED=.*/SIGNUP_ENABLED=false/' .env
docker compose up -d
```

## 8. More apps on the same VM (optional)

The VM's Caddy also serves any site file placed in `/etc/caddy-sites/`, so other projects can share
ports 80/443 and get their own HTTPS hostnames. [GhostOps](https://github.com/likith1231/ghostops)
and [AetherMed](https://github.com/likith1231/Aethermed) each ship a `deploy/oracle/setup.sh` that
installs k3s (Kubernetes) next to Orbit and publishes:

| App | URL |
|---|---|
| AetherMed | `https://aethermed.<DOMAIN>` |
| GhostOps Grafana / API | `https://grafana.<DOMAIN>`, `https://ghostops.<DOMAIN>` |

Run Orbit first (it owns Caddy), then each project's script from its own checkout.

---

## Day-2 operations

| Task | Command |
|---|---|
| Update to latest code | `git pull && docker compose up -d --build` |
| Logs | `docker compose logs -f backend` |
| Restart | `docker compose restart backend` |
| Back up the database | `docker compose exec db pg_dump -U orbit orbit > backup-$(date +%F).sql` |
| See user containers | `docker ps --filter label=orbit.kind` |
| Free disk space | `docker image prune -a` (images re-download on demand) |

Project files live in Postgres. The on-disk copies used by terminals are in `/var/lib/orbit/workspaces` and are recreated automatically.

## Troubleshooting

- **`curl https://<DOMAIN>` times out**: port 443 isn't open. Re-check step 2 (security list) **and** run `sudo iptables -L INPUT -n --line-numbers`. The ACCEPT rules for 80/443 must come before the `REJECT` line.
- **Certificate errors**: Caddy needs port 80 reachable for the Let's Encrypt challenge. Check `docker compose logs caddy`.
- **Frontend says "Could not reach the backend" / CORS errors**: `CORS_ORIGINS` must exactly match the frontend origin (scheme + host, no trailing slash). Restart after changing it.
- **Terminal says Docker is not available**: `docker compose exec backend ls -l /var/run/docker.sock` should list the socket.
- **Terminal has no `python3`/`git`**: the `orbit-terminal` image wasn't built. Run `docker compose build terminal-image`. Until it's built, terminals use plain `node:20-bookworm-slim`.
- **Docker Hub "too many requests"**: add `DOCKER_IMAGE_MIRROR=mirror.gcr.io` to `.env` and run `docker compose up -d`.
- **Arm (Ampere) compatibility**: all default language images are multi-arch and run natively on A1.
