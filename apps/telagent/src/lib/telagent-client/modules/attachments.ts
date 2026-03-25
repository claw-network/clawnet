import type { ApiClient } from '../client.js';

export class AttachmentsModule {
  constructor(private client: ApiClient) {}

  async initUpload(input: {
    filename: string;
    contentType: string;
    sizeBytes: number;
    manifestHash: string;
  }): Promise<{
    objectKey: string;
    uploadUrl: string;
    expiresAtMs: number;
    manifestHash: string;
    checksumAlgorithm: 'sha256';
  }> {
    const envelope = await this.client.requestData<{
      objectKey: string;
      uploadUrl: string;
      expiresAtMs: number;
      manifestHash: string;
      checksumAlgorithm: 'sha256';
    }>('POST', '/api/v1/attachments/init-upload', input);
    return envelope.data;
  }

  async completeUpload(input: {
    objectKey: string;
    manifestHash: string;
    checksum: string;
    fileContentType?: string;
    targetDid?: string;
  }): Promise<{
    objectKey: string;
    manifestHash: string;
    checksum: string;
    completedAtMs: number;
    status: 'ready';
  }> {
    const envelope = await this.client.requestData<{
      objectKey: string;
      manifestHash: string;
      checksum: string;
      completedAtMs: number;
      status: 'ready';
    }>('POST', '/api/v1/attachments/complete-upload', input);
    return envelope.data;
  }
}
