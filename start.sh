#!/bin/bash
set -e

if ! grep -q '^PUBLIC_APP_URL=http' .env 2>/dev/null; then
  echo "Внимание: задайте PUBLIC_APP_URL=http://IP_КОМПЬЮТЕРА:3000 в файле .env для QR-кодов"
fi

docker-compose up --build
