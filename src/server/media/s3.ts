import type { Readable } from 'node:stream'
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../env'
import { objectCacheControl } from './keys'

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

/**
 * Write an object. Without an explicit Cache-Control, public web images (derived/, portraits, avatars)
 * get the one-year immutable header, so the bucket's public domain serves them cacheable as is.
 */
export async function putObject(key: string, body: Uint8Array | Buffer, contentType: string, cacheControl?: string) {
  await s3().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl ?? objectCacheControl(key) }),
  )
}

/**
 * Rewrite an object's Content-Type and Cache-Control in place (CopyObject onto itself, MetadataDirective
 * REPLACE). User metadata is passed through, since REPLACE would drop it. With ifMatch the copy fails
 * (412) if the object changed after it was inspected.
 */
export async function replaceObjectHeaders(
  key: string,
  headers: { contentType: string; cacheControl: string; metadata?: Record<string, string>; ifMatch?: string },
) {
  await s3().send(
    new CopyObjectCommand({
      Bucket: bucket(),
      Key: key,
      CopySource: `${bucket()}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
      CopySourceIfMatch: headers.ifMatch,
      MetadataDirective: 'REPLACE',
      ContentType: headers.contentType,
      CacheControl: headers.cacheControl,
      Metadata: headers.metadata,
    }),
  )
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

/**
 * Presigned PUT locked to one body: Content-Length and Content-Type are signed headers
 * (X-Amz-SignedHeaders=content-length;content-type;host), so storage rejects any other size or type
 * with 403. The presigner signs ContentLength by default but always drops content-type unless asked.
 */
export async function presignPut(key: string, contentType: string, bytes: number, expiresIn = 900) {
  return getSignedUrl(s3Presign(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType, ContentLength: bytes }), {
    expiresIn,
    signableHeaders: new Set(['content-type']),
  })
}

/** First bytes of an object (HTTP Range, inclusive end). Used to read image headers without the whole file. */
export async function getObjectRange(key: string, start: number, end: number): Promise<Uint8Array> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=${start}-${end}` }))
  const bytes = await res.Body!.transformToByteArray()
  // a server that ignores Range sends the whole object; callers only look at the requested window
  return bytes.byteLength > end - start + 1 ? bytes.subarray(0, end - start + 1) : bytes
}

/** The first key under a prefix, or null when there is none. */
export async function firstKey(prefix: string): Promise<string | null> {
  const res = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, MaxKeys: 1 }))
  return res.Contents?.[0]?.Key ?? null
}

/** Every key under a prefix (paginated ListObjectsV2). */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const res = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }))
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key)
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return keys
}

/**
 * Multipart upload of a stream of unknown length (ZIP builds, database dumps). Memory stays at about
 * partSize × queueSize; call done() before writing into the stream and abort() if the producer fails.
 */
export function createUpload(
  key: string,
  body: Readable,
  opts: { contentType: string; cacheControl?: string; partSize?: number; queueSize?: number },
): Upload {
  return new Upload({
    client: s3(),
    params: { Bucket: bucket(), Key: key, Body: body, ContentType: opts.contentType, CacheControl: opts.cacheControl ?? objectCacheControl(key) },
    partSize: opts.partSize ?? 8 * 1024 * 1024,
    queueSize: opts.queueSize ?? 2,
    leavePartsOnError: false,
  })
}

/**
 * Whole object, but never more than maxBytes + 1 bytes (so an oversize object is detectable without
 * reading it all). With ifMatch the read fails (412) if the object changed since it was inspected.
 */
export async function getObjectBytesLimited(key: string, maxBytes: number, ifMatch?: string): Promise<Uint8Array> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${maxBytes}`, IfMatch: ifMatch }))
  const bytes = await res.Body!.transformToByteArray()
  return bytes.byteLength > maxBytes + 1 ? bytes.subarray(0, maxBytes + 1) : bytes
}

/** CopyObject that fails (412) unless the source still has `etag`: the copy is exactly what was checked. */
export async function copyObjectIfMatch(fromKey: string, toKey: string, etag: string, contentType?: string, cacheControl?: string) {
  await s3().send(
    new CopyObjectCommand({
      Bucket: bucket(),
      Key: toKey,
      CopySource: `${bucket()}/${encodeURIComponent(fromKey).replace(/%2F/g, '/')}`,
      CopySourceIfMatch: etag,
      ...(contentType || cacheControl ? { MetadataDirective: 'REPLACE', ContentType: contentType, CacheControl: cacheControl } : {}),
    }),
  )
}
