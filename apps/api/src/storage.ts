import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import type { AppConfig } from "./config";

export interface StorageService {
  mode: "local" | "s3";
  s3?: S3Client;
}

export interface LocalFileResult {
  stream: ReturnType<typeof createReadStream>;
  contentType: string;
  size: number;
}

interface UploadTokenPayload {
  key: string;
  contentType: string;
  expiresAt: number;
  sig: string;
}

export function createStorage(config: AppConfig): StorageService {
  if (config.FILE_STORAGE === "s3") {
    return {
      mode: "s3",
      s3: new S3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.S3_ACCESS_KEY,
          secretAccessKey: config.S3_SECRET_KEY
        }
      })
    };
  }

  return { mode: "local" };
}

export async function createUploadUrl(
  storage: StorageService,
  config: AppConfig,
  userId: string,
  fileName: string,
  contentType: string
): Promise<{ key: string; uploadUrl: string; publicUrl: string }> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const key = `users/${userId}/${nanoid(12)}-${safeName}`;

  if (storage.mode === "local") {
    const token = signUploadToken(config, {
      key,
      contentType,
      expiresAt: Date.now() + 5 * 60 * 1000
    });
    return {
      key,
      uploadUrl: `/api/uploads/local/${token}`,
      publicUrl: `${normalizeLocalPublicPath(config.LOCAL_FILE_PUBLIC_PATH)}/${key}`
    };
  }

  const command = new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
    ContentType: contentType
  });
  const uploadUrl = await getSignedUrl(requireS3(storage), command, { expiresIn: 60 * 5 });
  return {
    key,
    uploadUrl,
    publicUrl: `${config.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`
  };
}

export async function saveLocalUserFile(
  config: AppConfig,
  userId: string,
  fileName: string,
  contentType: string,
  body: Buffer
): Promise<{ key: string; publicUrl: string }> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "upload";
  const key = `users/${userId}/${nanoid(12)}-${safeName}`;
  const target = resolveLocalPath(config, key);
  await mkdir(path.dirname(target.filePath), { recursive: true });
  await writeFile(target.filePath, body, { flag: "wx" });
  await writeFile(
    target.metadataPath,
    JSON.stringify({ contentType, size: body.length, uploadedAt: new Date().toISOString() })
  );
  return {
    key,
    publicUrl: `${normalizeLocalPublicPath(config.LOCAL_FILE_PUBLIC_PATH)}/${key}`
  };
}

export async function saveLocalUpload(config: AppConfig, token: string, body: Buffer): Promise<{ key: string }> {
  const payload = verifyUploadToken(config, token);
  const target = resolveLocalPath(config, payload.key);
  await mkdir(path.dirname(target.filePath), { recursive: true });
  await writeFile(target.filePath, body, { flag: "wx" });
  await writeFile(
    target.metadataPath,
    JSON.stringify({ contentType: payload.contentType, size: body.length, uploadedAt: new Date().toISOString() })
  );
  return { key: payload.key };
}

function normalizeLocalPublicPath(value: string): string {
  const normalized = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return `/${normalized || "files"}`;
}

export async function readLocalFile(config: AppConfig, key: string): Promise<LocalFileResult | null> {
  const target = resolveLocalPath(config, key);
  try {
    const [fileStat, metadataRaw] = await Promise.all([
      stat(target.filePath),
      readFile(target.metadataPath, "utf-8").catch(() => "{}")
    ]);
    const metadata = JSON.parse(metadataRaw) as { contentType?: string };
    return {
      stream: createReadStream(target.filePath),
      contentType: metadata.contentType ?? "application/octet-stream",
      size: fileStat.size
    };
  } catch {
    return null;
  }
}

function requireS3(storage: StorageService): S3Client {
  if (!storage.s3) {
    throw new Error("S3 storage is not configured");
  }
  return storage.s3;
}

function signUploadToken(
  config: AppConfig,
  input: Omit<UploadTokenPayload, "sig">
): string {
  const sig = createSignature(config, input.key, input.contentType, input.expiresAt);
  return Buffer.from(JSON.stringify({ ...input, sig }), "utf-8").toString("base64url");
}

function verifyUploadToken(config: AppConfig, token: string): UploadTokenPayload {
  const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf-8")) as UploadTokenPayload;
  if (!payload.key || !payload.contentType || !payload.expiresAt || !payload.sig) {
    throw new Error("Invalid upload token");
  }
  if (payload.expiresAt < Date.now()) {
    throw new Error("Upload token expired");
  }
  const expected = createSignature(config, payload.key, payload.contentType, payload.expiresAt);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(payload.sig);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error("Invalid upload signature");
  }
  return payload;
}

function createSignature(config: AppConfig, key: string, contentType: string, expiresAt: number): string {
  const secret = config.UPLOAD_TOKEN_SECRET || config.VAPID_PRIVATE_KEY || config.FIREBASE_PRIVATE_KEY || "dev-upload-secret";
  return createHmac("sha256", secret).update(`${key}.${contentType}.${expiresAt}`).digest("base64url");
}

function resolveLocalPath(config: AppConfig, key: string): { filePath: string; metadataPath: string } {
  if (key.includes("..") || path.isAbsolute(key)) {
    throw new Error("Invalid file key");
  }
  const base = path.resolve(config.LOCAL_UPLOAD_DIR);
  const filePath = path.resolve(base, key);
  if (!filePath.startsWith(`${base}${path.sep}`)) {
    throw new Error("Invalid file path");
  }
  return {
    filePath,
    metadataPath: `${filePath}.json`
  };
}
