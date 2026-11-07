import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, copyFile, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
export function createStorage(env = process.env) {
  const local = env.STORAGE_MODE === "local";
  if (local && env.NODE_ENV === "production")
    throw Error("Production requires S3 media storage");
  if (local && !env.LOCAL_DATA_DIR) throw Error("LOCAL_DATA_DIR required");
  const bucket = env.S3_BUCKET;
  const client = local
    ? null
    : new S3Client({
        region: env.S3_REGION || "auto",
        endpoint: env.S3_ENDPOINT || undefined,
        forcePathStyle: true,
        credentials: env.S3_ACCESS_KEY_ID
          ? {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
      });
  const root = path.resolve(env.LOCAL_DATA_DIR || ".local", "media");
  const safe = (key) => {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes(".."))
      throw Error("Invalid storage key");
    return path.join(root, key);
  };
  return {
    local,
    configured:
      local ||
      Boolean(bucket && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY),
    async put(key, file, mime) {
      if (local) {
        const dst = safe(key);
        await mkdir(path.dirname(dst), { recursive: true });
        await copyFile(file, dst);
      } else
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: createReadStream(file),
            ContentType: mime,
            ContentLength: (await stat(file)).size,
          }),
        );
    },
    async read(key) {
      if (local) return createReadStream(safe(key));
      return (
        await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      ).Body;
    },
    async download(key, file) {
      await pipeline(await this.read(key), createWriteStream(file));
    },
    async signed(key) {
      if (local) throw Error("Public signed URLs require S3");
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 3600 },
      );
    },
    path: (key) => safe(key),
  };
}
