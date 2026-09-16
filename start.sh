#!/bin/bash
set -e

export WSL_IP=$(hostname -I | awk '{print $1}')
echo "WSL IP: $WSL_IP"

docker-compose up --build
