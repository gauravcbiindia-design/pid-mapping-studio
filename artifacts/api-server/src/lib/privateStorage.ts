import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: process.env.PRIVATE_OBJECT_STORAGE_AUDIENCE?.trim() ?? "",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateLocation() {
  if (!process.env.PRIVATE_OBJECT_STORAGE_AUDIENCE?.trim()) {
    throw new Error("Private storage credentials are not configured.");
  }
  const raw = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  const [bucketName, ...prefixParts] = raw?.split("/").filter(Boolean) ?? [];
  if (!bucketName) throw new Error("Private file storage is not configured.");
  return { bucketName, prefix: prefixParts.join("/") };
}

function objectNameFor(relativePath: string) {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid private file path.");
  }
  const { prefix } = privateLocation();
  return [prefix, relativePath].filter(Boolean).join("/");
}

async function signUpload(bucketName: string, objectName: string) {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Private upload could not be prepared.");
  const body = (await response.json()) as { signed_url?: string };
  if (!body.signed_url) throw new Error("Private upload could not be prepared.");
  return body.signed_url;
}

export async function createPrivateUpload(fileName: string) {
  const { bucketName } = privateLocation();
  const id = randomUUID();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "library-file";
  const relativePath = `uploads/${id}/${safeName}`;
  return {
    uploadUrl: await signUpload(bucketName, objectNameFor(relativePath)),
    objectPath: `/objects/${relativePath}`,
  };
}

export async function savePrivateFile(
  relativePath: string,
  contents: Buffer,
  contentType: string,
) {
  const { bucketName } = privateLocation();
  const file = storage.bucket(bucketName).file(objectNameFor(relativePath));
  await file.save(contents, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "private, no-store",
    },
  });
  return `/objects/${relativePath}`;
}

export async function getPrivateFile(objectPath: string): Promise<File> {
  if (!objectPath.startsWith("/objects/")) throw new Error("Private file was not found.");
  const relativePath = objectPath.slice("/objects/".length);
  const { bucketName } = privateLocation();
  const file = storage.bucket(bucketName).file(objectNameFor(relativePath));
  const [exists] = await file.exists();
  if (!exists) throw new Error("Private file was not found.");
  return file;
}

export async function privateFileResponseHeaders(file: File) {
  const [metadata] = await file.getMetadata();
  return {
    contentType: (metadata.contentType as string) || "application/octet-stream",
    contentLength: metadata.size ? String(metadata.size) : undefined,
  };
}
