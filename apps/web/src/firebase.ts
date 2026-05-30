import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);

let app: FirebaseApp | null = null;
export let auth: Auth | null = null;

if (hasFirebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
}

export async function firebaseLogin(email: string, password: string) {
  if (!auth) throw new Error("Firebase 설정이 필요합니다.");
  return signInWithEmailAndPassword(auth, email, password);
}

export async function firebaseRegister(email: string, password: string) {
  if (!auth) throw new Error("Firebase 설정이 필요합니다.");
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user);
  return credential;
}

export async function firebaseLogout() {
  if (auth) {
    await signOut(auth);
  }
}

export async function firebaseResetPassword(email: string) {
  if (!auth) throw new Error("Firebase 설정이 필요합니다.");
  await sendPasswordResetEmail(auth, email);
}
