/**
 * Neon Object Storage (S3-compatible). The app stores keys; browsers get presigned URLs.
 * Uploads go browser → presigned PUT so image bytes never pass through a function.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

export const BUCKET = "assets"; // declared in neon.ts, private

const ALLOWED = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type AllowedImageType = keyof typeof ALLOWED;

export const ASSET_KINDS = ["background", "object", "generated"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export function isAllowedImageType(ct: string): ct is AllowedImageType {
  return ct in ALLOWED;
}

export function isAssetKind(s: string): s is AssetKind {
  return (ASSET_KINDS as readonly string[]).includes(s);
}

export function objectKey(kind: AssetKind, gameId: string, contentType: string): string {
  if (!isAllowedImageType(contentType)) throw new Error(`Disallowed content type ${contentType}`);
  return `games/${gameId}/${kind}/${nanoid()}.${ALLOWED[contentType]}`;
}

/**
 * True iff `key` lives under this game's namespace for `kind` and carries no `..`
 * segment (path traversal). Pure — no I/O — so a caller-supplied key can be checked
 * before it is ever written to a row.
 */
export function isOwnedKey(kind: AssetKind, gameId: string, key: string): boolean {
  const prefix = `games/${gameId}/${kind}/`;
  if (!key.startsWith(prefix)) return false;
  return !key.split("/").includes("..");
}

let client: S3Client | undefined;
function s3(): S3Client {
  client ??= new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION,
    forcePathStyle: true,
  });
  return client;
}

export function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), {
    expiresIn: 300,
  });
}

export function presignGet(key: string): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
}

/** Presign a set of keys up front so a synchronous `resolveUrl` can be given to `projectGame`. */
export async function urlResolverFor(keys: readonly (string | null)[]): Promise<(key: string) => string> {
  const unique = [...new Set(keys.filter((k): k is string => k !== null))];
  const urls = await Promise.all(unique.map(presignGet));
  const map = new Map(unique.map((k, i) => [k, urls[i]]));
  return (key) => {
    const url = map.get(key);
    if (!url) throw new Error(`No presigned URL for key ${key}`);
    return url;
  };
}
