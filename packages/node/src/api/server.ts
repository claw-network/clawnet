import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  decryptKeyRecord,
  keyIdFromPublicKey,
  loadKeyRecord,
  publicKeyFromDid,
  resolveStoragePaths,
  verifyCapabilityCredential,
} from '@clawtoken/core';
import { createIdentityCapabilityRegisterEnvelope, CapabilityCredential } from '@clawtoken/protocol';

const MAX_BODY_BYTES = 1_000_000;

export interface ApiServerConfig {
  host: string;
  port: number;
  dataDir?: string;
}

export interface CapabilityRegisterRequest {
  did: string;
  passphrase: string;
  credential: CapabilityCredential;
  nonce: number;
  prev?: string;
  ts?: number;
}

export class ApiServer {
  private server?: Server;

  constructor(
    private readonly config: ApiServerConfig,
    private readonly runtime: {
      publishEvent: (envelope: Record<string, unknown>) => Promise<string>;
    },
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    this.server = createServer((req, res) => {
      void this.route(req, res);
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ? new URL(req.url, `http://${this.config.host}`) : null;
    const method = req.method ?? 'GET';

    if (method === 'POST' && url?.pathname === '/api/identity/capabilities') {
      await this.handleCapabilityRegister(req, res);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  }

  private async handleCapabilityRegister(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody<CapabilityRegisterRequest>(req, res);
    if (!body) {
      return;
    }
    if (!body.did || !body.passphrase || !body.credential) {
      sendJson(res, 400, { error: 'missing_required_fields' });
      return;
    }
    if (!Number.isInteger(body.nonce) || body.nonce < 1) {
      sendJson(res, 400, { error: 'invalid_nonce' });
      return;
    }
    const credential = body.credential;
    if (!(await verifyCapabilityCredential(credential))) {
      sendJson(res, 400, { error: 'invalid_credential' });
      return;
    }
    if (credential.credentialSubject?.id !== body.did) {
      sendJson(res, 400, { error: 'credential_subject_mismatch' });
      return;
    }

    const subject = credential.credentialSubject;
    if (!subject?.name || !subject?.pricing) {
      sendJson(res, 400, { error: 'credential_subject_incomplete' });
      return;
    }

    let privateKey: Uint8Array;
    try {
      const publicKey = publicKeyFromDid(body.did);
      const keyId = keyIdFromPublicKey(publicKey);
      const paths = resolveStoragePaths(this.config.dataDir);
      const record = await loadKeyRecord(paths, keyId);
      privateKey = await decryptKeyRecord(record, body.passphrase);
    } catch (error) {
      sendJson(res, 400, { error: 'key_unavailable' });
      return;
    }

    const envelope = await createIdentityCapabilityRegisterEnvelope({
      did: body.did,
      privateKey,
      name: subject.name,
      pricing: subject.pricing,
      description: subject.description,
      credential,
      ts: body.ts ?? Date.now(),
      nonce: body.nonce,
      prev: body.prev,
    });

    try {
      const hash = await this.runtime.publishEvent(envelope);
      const response: Record<string, unknown> = {
        id: hash,
        name: subject.name,
        pricing: subject.pricing,
        verified: false,
        registeredAt: body.ts ?? Date.now(),
      };
      if (subject.description) {
        response.description = subject.description;
      }
      sendJson(res, 201, response);
    } catch (error) {
      sendJson(res, 500, { error: 'publish_failed' });
    }
  }
}

async function readJsonBody<T>(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<T | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: 'payload_too_large' });
      return null;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    sendJson(res, 400, { error: 'empty_body' });
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    sendJson(res, 400, { error: 'invalid_json' });
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
