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

## Linux 서버 설정 Docker 없이

실제 서버가 Linux이고 Docker를 안 쓸 거면 이 방식으로 갑니다.

구조는 이렇게 잡습니다.

- Caddy: 외부 `80/443` HTTPS 담당
- Caddy file server: React 빌드 결과물 서빙
- Node API: 내부 `127.0.0.1:4000`
- PostgreSQL: 로컬 `5432`
- Redis: 로컬 `6379`
- 업로드 파일: 서버 로컬 디스크 `/var/lib/everyonemessage/uploads`

### 1. 도메인 DNS 확인

도메인 `em33.kro.kr`의 A 레코드가 서버 공인 IP를 가리키게 합니다.

서버에서 확인:

```bash
dig +short em33.kro.kr
curl -4 ifconfig.me
```

두 IP가 같아야 Caddy가 HTTPS 인증서를 정상 발급받습니다.

방화벽을 쓰면 `80`, `443`을 열어둡니다.

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow OpenSSH
sudo ufw status
```

### 2. 서버 패키지 설치

Ubuntu 기준입니다.

```bash
sudo apt update
sudo apt install -y git curl postgresql postgresql-contrib redis-server caddy
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 3. 앱 사용자와 폴더 만들기

```bash
sudo useradd --system --create-home --home-dir /opt/everyonemessage --shell /usr/sbin/nologin emapp
sudo mkdir -p /opt/everyonemessage
sudo mkdir -p /var/lib/everyonemessage/uploads
sudo chown -R emapp:emapp /opt/everyonemessage /var/lib/everyonemessage
```

코드는 `/opt/everyonemessage`에 둡니다. Git으로 배포할 때는 서버에서 이 폴더에 clone/pull 하면 됩니다.

```bash
sudo -u emapp git clone <YOUR_REPO_URL> /opt/everyonemessage
cd /opt/everyonemessage
```

이미 파일을 직접 올렸다면 clone 대신 해당 폴더에 프로젝트가 있으면 됩니다.

### 4. PostgreSQL DB 만들기

비밀번호는 꼭 바꿔서 사용합니다.

```bash
sudo -u postgres psql
```

PostgreSQL 콘솔에서:

```sql
CREATE USER em WITH PASSWORD '여기에_강한_DB_비밀번호';
CREATE DATABASE everyonemessage OWNER em;
\q
```

### 5. 서버용 `.env` 작성

서버에서는 `/opt/everyonemessage/.env`를 만듭니다.

```bash
cd /opt/everyonemessage
sudo -u emapp nano .env
```

기본 형태:

```env
APP_DOMAIN=em33.kro.kr

VITE_API_BASE_URL=/api
VITE_SOCKET_PATH=/socket.io
VITE_FIREBASE_API_KEY=Firebase_웹_apiKey
VITE_FIREBASE_AUTH_DOMAIN=everyone-message.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=everyone-message
VITE_FIREBASE_APP_ID=Firebase_웹_appId
VITE_VAPID_PUBLIC_KEY=VAPID_Public_Key

NODE_ENV=production
PORT=4000
WEB_ORIGIN=https://em33.kro.kr
DATABASE_URL=postgres://em:여기에_강한_DB_비밀번호@localhost:5432/everyonemessage
REDIS_URL=redis://localhost:6379

AUTH_MODE=firebase
FIREBASE_PROJECT_ID=everyone-message
FIREBASE_CLIENT_EMAIL=Firebase_Admin_client_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nFirebase_Admin_private_key_전체\n-----END PRIVATE KEY-----\n"

FILE_STORAGE=local
LOCAL_UPLOAD_DIR=/var/lib/everyonemessage/uploads
LOCAL_FILE_PUBLIC_PATH=/files
UPLOAD_TOKEN_SECRET=openssl_rand_hex_값

VAPID_PUBLIC_KEY=VAPID_Public_Key
VAPID_PRIVATE_KEY=VAPID_Private_Key
VAPID_SUBJECT=mailto:swk1072@gmail.com
```

중요한 점:

- `WEB_ORIGIN=https://em33.kro.kr` 뒤에 공백을 넣지 않습니다.
- `FIREBASE_PRIVATE_KEY`는 처음부터 끝까지 전체 키가 있어야 합니다.
- private key의 실제 줄바꿈은 `\n`으로 넣습니다.
- `VITE_`로 시작하는 값은 프론트 빌드 때 박힙니다. 바꾸면 `npm run build`를 다시 해야 합니다.
- `UPLOAD_TOKEN_SECRET`은 아래 명령으로 만들면 됩니다.

```bash
openssl rand -hex 32
```

### 6. 노출된 키 재발급

채팅이나 문서에 private key를 붙여넣었다면 노출된 키로 봐야 합니다.

반드시 새로 발급하세요.

1. Firebase Console -> Project settings -> Service accounts
2. 기존 private key 삭제
3. 새 private key 생성
4. `.env`의 `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` 확인
5. VAPID도 새로 만들려면:

   ```bash
   cd /opt/everyonemessage
   npx web-push generate-vapid-keys
   ```

6. 새 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VITE_VAPID_PUBLIC_KEY`를 `.env`에 반영

### 7. Firebase 콘솔 설정

Firebase Console에서:

- Authentication -> Sign-in method -> Email/Password 활성화
- Authentication -> Settings -> Authorized domains에 `em33.kro.kr` 추가
- 기존 `localhost`는 개발용으로 남겨도 됩니다.

### 8. 빌드

```bash
cd /opt/everyonemessage
sudo -u emapp npm ci
sudo -u emapp npm run build
```

빌드가 끝나면 웹 정적 파일은 `/opt/everyonemessage/apps/web/dist`에 생깁니다.

### 9. API systemd 등록

repo에 있는 예시 파일을 systemd로 복사합니다.

```bash
sudo cp /opt/everyonemessage/deploy/everyonemessage-api.service /etc/systemd/system/everyonemessage-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now everyonemessage-api
sudo systemctl status everyonemessage-api
```

API 확인:

```bash
curl http://127.0.0.1:4000/api/health
```

정상이라면 `{"ok":true,...}` 형태가 나옵니다.

로그 확인:

```bash
sudo journalctl -u everyonemessage-api -f
```

### 10. Caddy 설정

Docker가 아니면 [Caddyfile.linux](./Caddyfile.linux)를 사용합니다.

```bash
sudo cp /opt/everyonemessage/Caddyfile.linux /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

Caddy가 환경변수 `APP_DOMAIN`, `CADDY_EMAIL`을 읽게 `/etc/caddy/caddy.env`를 만듭니다.

```bash
sudo nano /etc/caddy/caddy.env
```

내용:

```env
APP_DOMAIN=em33.kro.kr
CADDY_EMAIL=swk1072@gmail.com
```

Caddy systemd override를 만듭니다.

```bash
sudo systemctl edit caddy
```

아래를 넣습니다.

```ini
[Service]
EnvironmentFile=/etc/caddy/caddy.env
```

적용:

```bash
sudo systemctl daemon-reload
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

최종 확인:

```bash
curl https://em33.kro.kr/api/health
```

### 11. 업데이트할 때

서버에서:

```bash
cd /opt/everyonemessage
sudo -u emapp git pull
sudo -u emapp npm ci
sudo -u emapp npm run build
sudo systemctl restart everyonemessage-api
sudo systemctl reload caddy
```

프론트 환경변수(`VITE_...`)를 바꿨으면 반드시 `npm run build`를 다시 해야 합니다.

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

### 6. 파일 저장소 로컬 디스크

Linux 서버에서는 로컬 디스크 저장을 기본으로 씁니다.

```env
FILE_STORAGE=local
LOCAL_UPLOAD_DIR=/var/lib/everyonemessage/uploads
LOCAL_FILE_PUBLIC_PATH=/files
UPLOAD_TOKEN_SECRET=openssl_rand_hex_값
```

로컬 PC에서만 테스트할 때는 이렇게 둬도 됩니다.

```env
FILE_STORAGE=local
LOCAL_UPLOAD_DIR=uploads
LOCAL_FILE_PUBLIC_PATH=/files
UPLOAD_TOKEN_SECRET=dev-secret
```

### 7. 파일 저장소 MinIO/S3

S3-compatible 저장소를 쓸 때만 `FILE_STORAGE=s3`로 바꾸고 아래 값을 씁니다.

```env
FILE_STORAGE=s3
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=everyonemessage
S3_ACCESS_KEY=em_minio
S3_SECRET_KEY=em_minio_password
S3_PUBLIC_BASE_URL=http://localhost:9000/everyonemessage
```

MinIO, AWS S3, Cloudflare R2 같은 S3-compatible 저장소 값으로 교체할 수 있습니다.

### 8. Web Push 알림

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
