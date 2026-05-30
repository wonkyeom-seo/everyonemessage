import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import type { AppConfig } from "./config";

export function createStorage(config: AppConfig): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY
    }
  });
}

export async function createUploadUrl(
  storage: S3Client,
  config: AppConfig,
  userId: string,
  fileName: string,
  contentType: string
): Promise<{ key: string; uploadUrl: string; publicUrl: string }> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const key = `users/${userId}/${nanoid(12)}-${safeName}`;
  const command = new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
    ContentType: contentType
  });
  const uploadUrl = await getSignedUrl(storage, command, { expiresIn: 60 * 5 });
  return {
    key,
    uploadUrl,
    publicUrl: `${config.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`
  };
}
