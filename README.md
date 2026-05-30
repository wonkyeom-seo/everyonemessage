# EveryoneMessage

EveryoneMessage는 Firebase Auth, 커스텀 `#emid`, 친구 요청, 실시간 DM, 그룹채팅, 24시간 상태메시지, 파일 전송, URL 미리보기, Web Push, 차단/신고를 포함하는 PWA 메신저입니다.

## 기술 스택

- Web: React, TypeScript, Vite, PWA manifest/service worker
- API: Node.js, TypeScript, Fastify, Socket.IO
- Data: PostgreSQL, Redis
- Auth/email: Firebase Auth only
- Files: S3-compatible storage, MinIO for local Docker
- Edge: Caddy reverse proxy with HTTPS

## 기본 포트

- Caddy: `80`, `443`
- Web: `3000`
- API: `4000`
- PostgreSQL: `5432`
- Redis: `6379`
- MinIO: `9000`, console `9001`

## 로컬 실행 순서

1. `.env.example`을 복사해서 `.env`를 만듭니다.

   ```powershell
   Copy-Item .env.example .env
   ```

2. 아래의 **환경변수 설정** 섹션을 보고 `.env` 값을 채웁니다.

3. 패키지를 설치합니다.

   ```powershell
   npm install
   ```

4. DB/Redis/파일 저장소를 Docker로 실행합니다.

   ```powershell
   docker compose up postgres redis minio
   ```

5. 앱을 실행합니다.

   ```powershell
   npm run dev
   ```

웹앱은 `http://localhost:3000`에서 열립니다. API 상태 확인 주소는 `http://localhost:4000/api/health`입니다.

## 환경변수 설정

`.env` 파일은 실제 비밀키가 들어가므로 Git에 올리면 안 됩니다. 이 저장소에서는 `.gitignore`로 `.env`가 제외되어 있습니다.

### 1. 도메인/포트

로컬 개발이면 기본값 그대로 둡니다.

```env
APP_DOMAIN=localhost
PORT=4000
WEB_ORIGIN=http://localhost:3000
VITE_API_BASE_URL=/api
VITE_SOCKET_PATH=/socket.io
```

서버에 올리고 Caddy로 HTTPS reverse proxy를 붙이면 이렇게 바꿉니다.

```env
APP_DOMAIN=your-domain.com
WEB_ORIGIN=https://your-domain.com
VITE_API_BASE_URL=/api
VITE_SOCKET_PATH=/socket.io
```

Caddy는 외부 `80/443`을 받고 내부의 `web:3000`, `api:4000`으로 넘깁니다.

### 2. Firebase Auth 웹 설정

Firebase 콘솔에서 가져옵니다.

1. Firebase Console에서 프로젝트를 만듭니다.
2. `Authentication`에서 `Email/Password` 로그인을 켭니다.
3. `Project settings` -> `General` -> `Your apps`에서 Web app을 추가합니다.
4. Firebase SDK 설정값에서 아래 값을 `.env`에 넣습니다.

```env
VITE_FIREBASE_API_KEY=Firebase 웹 apiKey
VITE_FIREBASE_AUTH_DOMAIN=Firebase 웹 authDomain
VITE_FIREBASE_PROJECT_ID=Firebase projectId
VITE_FIREBASE_APP_ID=Firebase appId
```

예시 형식은 이렇게 생겼습니다.

```env
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

Firebase `Authentication`의 Authorized domains에는 최소 `localhost`와 나중에 사용할 실제 도메인을 추가해야 합니다.

### 3. Firebase Admin 서버 설정

API 서버가 Firebase 로그인 토큰을 검증하려면 Admin SDK 키가 필요합니다.

1. Firebase Console에서 `Project settings`로 갑니다.
2. `Service accounts` 탭을 엽니다.
3. `Generate new private key`를 눌러 JSON 파일을 받습니다.
4. JSON에서 아래 값을 `.env`에 넣습니다.

```env
AUTH_MODE=firebase
FIREBASE_PROJECT_ID=JSON의 project_id
FIREBASE_CLIENT_EMAIL=JSON의 client_email
FIREBASE_PRIVATE_KEY=JSON의 private_key
```

`FIREBASE_PRIVATE_KEY`는 줄바꿈을 `\n`으로 바꿔 한 줄로 넣는 것을 권장합니다.

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n여기에_긴_키_내용\n-----END PRIVATE KEY-----\n"
```

### 4. Firebase 없이 로컬 UI만 빠르게 볼 때

Firebase 설정 전에도 화면을 볼 수 있게 개발 로그인 모드가 들어 있습니다.

`.env`에서 아래처럼 바꿉니다.

```env
AUTH_MODE=dev
```

그리고 `VITE_FIREBASE_*` 값을 비워두면 웹앱 로그인 화면에서 개발 로그인으로 들어갑니다. 이 모드는 로컬 개발용입니다. 서버에 배포할 때는 반드시 `AUTH_MODE=firebase`를 사용해야 합니다.

### 5. DB/Redis

로컬 Docker 기본값입니다. 처음에는 그대로 두면 됩니다.

```env
DATABASE_URL=postgres://em:em_password@localhost:5432/everyonemessage
REDIS_URL=redis://localhost:6379
```

서버로 옮길 때는 운영 DB 주소로 바꿉니다. PostgreSQL 데이터와 파일 저장소는 같이 백업해야 합니다.

### 6. 파일 저장소 MinIO/S3

로컬 Docker는 MinIO를 씁니다.

```env
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=everyonemessage
S3_ACCESS_KEY=em_minio
S3_SECRET_KEY=em_minio_password
S3_PUBLIC_BASE_URL=http://localhost:9000/everyonemessage
```

서버에서는 MinIO, AWS S3, Cloudflare R2 같은 S3-compatible 저장소 값으로 교체하면 됩니다.

### 7. Web Push 알림

푸시 알림을 쓰려면 VAPID 키가 필요합니다.

1. 아래 명령으로 키를 만듭니다.

   ```powershell
   npx web-push generate-vapid-keys
   ```

2. 출력된 `Public Key`와 `Private Key`를 `.env`에 넣습니다.

```env
VAPID_PUBLIC_KEY=Public Key
VAPID_PRIVATE_KEY=Private Key
VITE_VAPID_PUBLIC_KEY=Public Key
VAPID_SUBJECT=mailto:admin@your-domain.com
```

`VAPID_PUBLIC_KEY`와 `VITE_VAPID_PUBLIC_KEY`는 같은 Public Key를 넣습니다. 아직 푸시 알림을 안 쓸 거면 비워둬도 앱 실행은 됩니다.

## 배포 구조

Caddy가 `80/443`을 담당하고 단일 도메인을 아래처럼 라우팅합니다.

- `/` -> web container on `3000`
- `/api/*` -> API container on `4000`
- `/socket.io/*` -> API container on `4000`

기본 Caddy 설정은 [Caddyfile](./Caddyfile)에 있습니다.

```caddyfile
{$APP_DOMAIN} {
  encode zstd gzip

  reverse_proxy /api/* api:4000
  reverse_proxy /socket.io/* api:4000

  reverse_proxy web:3000
}
```

자세한 서버 체크리스트는 [DEPLOYMENT.md](./DEPLOYMENT.md)를 봅니다.
