import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../env'

let client: S3Client | undefined
let presignClient: S3Client | undefined

function makeClient(endpoint: string) {
  const e = env()
  return new S3Client({
    region: e.S3_REGION,
    endpoint,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    // R2 rejects the newer default checksum headers on presigned PUTs from browsers
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

export function s3(): S3Client {
  client ??= makeClient(env().S3_ENDPOINT)
  return client
}

/** Presigned URLs are opened by browsers, which may need a different host than the server (dev). */
function s3Presign(): S3Client {
  presignClient ??= makeClient(env().S3_PUBLIC_ENDPOINT || env().S3_ENDPOINT)
  return presignClient
}

export function bucket(): string {
  return env().S3_BUCKET
}

export function isNotFound(err: unknown): boolean {
  if (err instanceof S3ServiceException) return err.$metadata.httpStatusCode === 404 || err.name === 'NoSuchKey' || err.name === 'NotFound'
  return false
}

export async function getObject(key: string, opts: { ifNoneMatch?: string } = {}) {
  return s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key, IfNoneMatch: opts.ifNoneMatch }))
}

export async function headObject(key: string) {
  try {
    return await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await getObject(key)
  return res.Body!.transformToByteArray()
}

export async function putObject(key: string, body: Uint8Array | Buffer, contentType: string, cacheControl?: string) {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }))
}

export async function copyObject(fromKey: string, toKey: string, contentType?: string, cacheControl?: string) {
  await s3().send(
    new CopyObjectCommand({
      Bucket: bucket(),
      Key: toKey,
      CopySource: `${bucket()}/${encodeURIComponent(fromKey).replace(/%2F/g, '/')}`,
      ...(contentType || cacheControl ? { MetadataDirective: 'REPLACE', ContentType: contentType, CacheControl: cacheControl } : {}),
    }),
  )
}

export async function deleteObjects(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000)
    if (!chunk.length) continue
    await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }))
  }
}

export async function presignGet(key: string, opts: { expiresIn?: number; filename?: string; inline?: boolean } = {}) {
  const disposition = opts.filename
    ? `${opts.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(opts.filename)}`
    : undefined
  return getSignedUrl(s3Presign(), new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentDisposition: disposition }), {
    expiresIn: opts.expiresIn ?? 120,
  })
}

export async function presignPut(key: string, contentType: string, expiresIn = 900) {
  return getSignedUrl(s3Presign(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn })
}
