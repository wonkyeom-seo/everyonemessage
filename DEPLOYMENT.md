# Deployment Notes

## Network Shape

Caddy is the only public web server.

- Public: `80`, `443`
- Internal web container: `3000`
- Internal API container: `4000`
- Internal Socket.IO path: `/socket.io`

The app is designed for a single domain:

- `https://your-domain.example/` -> web
- `https://your-domain.example/api/*` -> API
- `https://your-domain.example/socket.io/*` -> API WebSocket

## Required Production Environment

Set these values before deploying:

- `APP_DOMAIN`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VITE_VAPID_PUBLIC_KEY`

`FIREBASE_PRIVATE_KEY` should keep newline escapes as `\n` if stored in a single-line environment value.

## Firebase Auth

Use Firebase for Auth only.

Required console settings:

- Enable Email/Password provider.
- Add `localhost` and the production domain to Authorized domains.
- Set email action URLs to the production domain once deployed.
- The API verifies Firebase ID tokens through Firebase Admin SDK.

## Data And Storage

- PostgreSQL is the source of truth for users, em IDs, friend graph, conversations, messages, reports, and push subscriptions.
- Redis is reserved for realtime/session scaling.
- MinIO is used locally and can be replaced with S3/R2 by changing S3-compatible environment variables.
- Back up PostgreSQL and object storage together because messages can reference uploaded files.

## Service Checks

After deployment:

```powershell
curl https://your-domain.example/api/health
```

Then verify:

- Firebase login works from the production domain.
- `GET /api/me` succeeds after email verification.
- Socket.IO connects through `/socket.io`.
- Web Push permission can be granted and a friend request creates a notification.
- Route changes in the PWA do not trigger a full page reload.
