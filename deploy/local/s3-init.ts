// `local` compose profile only: create S3_BUCKET on the local RustFS container if it does not exist.
// Refuses to touch Cloudflare R2 or the production bucket.
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

const endpoint = process.env.S3_ENDPOINT ?? ''
const bucket = process.env.S3_BUCKET ?? ''
if (!endpoint || !bucket) throw new Error('S3_ENDPOINT and S3_BUCKET are required')
if (new URL(endpoint).hostname.endsWith('.r2.cloudflarestorage.com') || bucket === 'wuwa') {
  throw new Error('s3-init only creates buckets on the local RustFS container, never on R2')
}

const s3 = new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' },
})

for (let attempt = 1; ; attempt++) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    console.log(`s3-init: bucket ${bucket} exists`)
    break
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }))
      console.log(`s3-init: created bucket ${bucket}`)
      break
    }
    if (attempt >= 30) throw err
    await Bun.sleep(1000) // RustFS still starting
  }
}
