# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline 2>/dev/null || npm install

COPY . .
ARG VITE_PUBLIC_APP_URL
ENV VITE_PUBLIC_APP_URL=$VITE_PUBLIC_APP_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
