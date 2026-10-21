import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

// Adaptador del bucket privado. Solo lo usa el backend: el navegador nunca habla con S3
// (ADR 0004). Los tests pueden inyectar uno en memoria.
export type AttachmentStorage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; length: number | undefined }>;
  getBuffer(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
};

export function createS3Storage(client: S3Client, bucket: string): AttachmentStorage {
  async function get(key: string) {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return { stream: object.Body as Readable, length: object.ContentLength };
  }
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    get,
    async getBuffer(key) {
      const { stream } = await get(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      return Buffer.concat(chunks);
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
