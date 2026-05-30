import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { AppConfig } from "./config";
import { HttpError } from "./errors";

export interface AuthUser {
  firebaseUid: string;
  email: string;
  emailVerified: boolean;
}

let firebaseReady = false;

function ensureFirebase(config: AppConfig): void {
  if (firebaseReady || config.AUTH_MODE !== "firebase") {
    return;
  }
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: config.FIREBASE_PROJECT_ID,
        clientEmail: config.FIREBASE_CLIENT_EMAIL,
        privateKey: config.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
      })
    });
  }
  firebaseReady = true;
}

export async function verifyAuthHeader(config: AppConfig, header: string | undefined): Promise<AuthUser> {
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "로그인이 필요합니다.");
  }

  const token = header.slice("Bearer ".length).trim();
  if (config.AUTH_MODE === "dev") {
    const [, firebaseUid, email = "dev@example.com"] = token.match(/^dev:([^:]+):?(.+)?$/) ?? [];
    if (!firebaseUid) {
      throw new HttpError(401, "개발용 토큰 형식은 dev:<uid>:<email> 입니다.");
    }
    return { firebaseUid, email, emailVerified: true };
  }

  ensureFirebase(config);
  const decoded = await getAuth().verifyIdToken(token);
  if (!decoded.email) {
    throw new HttpError(401, "이메일이 있는 Firebase 계정만 사용할 수 있습니다.");
  }
  if (!decoded.email_verified) {
    throw new HttpError(403, "이메일 인증 후 이용할 수 있습니다.");
  }
  return {
    firebaseUid: decoded.uid,
    email: decoded.email,
    emailVerified: Boolean(decoded.email_verified)
  };
}
