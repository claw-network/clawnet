import { ClawDIDDocument } from './document.js';

export interface DIDResolver {
  resolve(did: string): Promise<ClawDIDDocument | null>;
}

export class MemoryDIDResolver implements DIDResolver {
  private readonly documents = new Map<string, ClawDIDDocument>();

  async resolve(did: string): Promise<ClawDIDDocument | null> {
    return this.documents.get(did) ?? null;
  }

  async store(document: ClawDIDDocument): Promise<void> {
    this.documents.set(document.id, document);
  }
}
