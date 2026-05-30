# EveryoneMessage

EveryoneMessage is a PWA messenger with Firebase Auth, custom `#emid` handles, friend requests, real-time DMs, group chat, 24-hour status messages, file sharing, URL previews, Web Push, blocking, and reporting.

## Stack

- Web: React, TypeScript, Vite, PWA manifest/service worker
- API: Node.js, TypeScript, Fastify, Socket.IO
- Data: PostgreSQL, Redis
- Auth/email: Firebase Auth only
- Files: S3-compatible storage, MinIO for local Docker
- Edge: Caddy reverse proxy with HTTPS

## Default Ports

- Caddy: `80`, `443`
- Web: `3000`
- API: `4000`
- PostgreSQL: `5432`
- Redis: `6379`
- MinIO: `9000`, console `9001`

## Local Development

1. Copy `.env.example` to `.env` and fill Firebase web/admin settings.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Start local services with Docker if you want the database stack:

   ```powershell
   docker compose up postgres redis minio
   ```

4. Run the apps:

   ```powershell
   npm run dev
   ```

The web app opens at `http://localhost:3000`. The API health endpoint is `http://localhost:4000/api/health`.

For local API testing without Firebase, set `AUTH_MODE=dev` and send `Authorization: Bearer dev:<uid>:<email>`.

## Production Shape

Caddy owns `80/443` and routes a single domain:

- `/` -> web container on `3000`
- `/api/*` -> API container on `4000`
- `/socket.io/*` -> API container on `4000`

Firebase Authorized domains should include both `localhost` and the production domain.
