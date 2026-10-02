#!/usr/bin/env bash
# Start Orbit IDE locally: installs/updates everything, stops any old backend,
# checks your setup, then runs backend + frontend together. Ctrl+C stops both.
#   Usage:  ./dev.sh
set -e
cd "$(dirname "$0")"

echo "==> Installing / updating dependencies"
(cd backend && npm install --no-audit --no-fund --loglevel=error)
(cd frontend && npm install --no-audit --no-fund --loglevel=error)

echo "==> Updating the database"
(cd backend && npx prisma migrate deploy)

echo "==> Stopping any backend that's still running"
(cd backend && node scripts/free-port.js)

echo "==> Checking setup"
(cd backend && node scripts/doctor.js) || {
  echo "Fix the ✖ items above, then run ./dev.sh again."
  exit 1
}

echo "==> Starting backend (http://localhost:5000) and frontend (http://localhost:5173)"
(cd backend && exec node --watch server.js) &
BACKEND=$!
(cd frontend && exec npx vite) &
FRONTEND=$!
trap 'kill $BACKEND $FRONTEND 2>/dev/null' EXIT INT TERM
wait
