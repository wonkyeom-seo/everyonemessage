import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://em:em_password@localhost:5432/everyonemessage"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  AUTH_MODE: z.enum(["firebase", "dev"]).default("firebase"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("everyonemessage"),
  S3_ACCESS_KEY: z.string().default("em_minio"),
  S3_SECRET_KEY: z.string().default("em_minio_password"),
  S3_PUBLIC_BASE_URL: z.string().default("http://localhost:9000/everyonemessage"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const config = envSchema.parse(process.env);
  if (config.AUTH_MODE === "firebase") {
    const missing = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"].filter(
      (key) => !process.env[key]
    );
    if (missing.length > 0) {
      throw new Error(`Missing Firebase Admin env for AUTH_MODE=firebase: ${missing.join(", ")}`);
    }
  }
  return config;
}
