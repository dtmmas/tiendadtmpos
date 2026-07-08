#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/tiendadtmpos}"
APP_NAME="${APP_NAME:-tiendadtmpos-api}"
HEALTH_URL="${HEALTH_URL:-http://localhost:4003/api/health}"
RUN_NGINX_RELOAD="${RUN_NGINX_RELOAD:-1}"
ECOSYSTEM_FILE="${ECOSYSTEM_FILE:-server/ecosystem.config.cjs}"

echo "==> Actualizando proyecto en ${PROJECT_DIR}"
cd "${PROJECT_DIR}"

echo "==> Git pull"
git pull origin main

echo "==> Instalando dependencias del backend"
cd "${PROJECT_DIR}/server"
npm install

echo "==> Ejecutando bootstrap de produccion"
npm run bootstrap:prod

echo "==> Instalando dependencias del frontend"
cd "${PROJECT_DIR}/client"
npm install

echo "==> Compilando frontend"
npm run build

echo "==> Reiniciando PM2"
cd "${PROJECT_DIR}"
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
else
  pm2 start "${ECOSYSTEM_FILE}" --update-env
fi
pm2 save

echo "==> Esperando API"
sleep 3

echo "==> Health check"
curl "${HEALTH_URL}"
echo

echo "==> PM2 status"
pm2 list

echo "==> Ultimos logs"
pm2 logs "${APP_NAME}" --lines 50 --nostream

if [ "${RUN_NGINX_RELOAD}" = "1" ]; then
  echo "==> Validando y recargando Nginx"
  nginx -t
  systemctl reload nginx
fi

echo "==> Despliegue completado"
