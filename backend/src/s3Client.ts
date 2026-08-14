import { S3Client } from '@aws-sdk/client-s3'

// Credentials come from the AWS SDK's default provider chain, which reads
// AWS_PROFILE against the read-only ~/.aws mount. No keys are ever handled
// directly by this service.
export function createS3Client(region?: string): S3Client {
  return region ? new S3Client({ region }) : new S3Client({})
}
