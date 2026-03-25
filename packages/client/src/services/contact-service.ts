import { ErrorCodes, TelagentError, type Contact } from '../protocol/index.js';

import type { ContactRepository } from '../storage/contact-repository.js';

export interface AddContactInput {
  did: string;
  displayName: string;
  avatarUrl?: string;
  notes?: string;
}

export interface UpdateContactInput {
  displayName?: string;
  avatarUrl?: string;
  notes?: string;
}

export class ContactService {
  constructor(private readonly repository: ContactRepository) {}

  ensureContact(input: AddContactInput): Contact {
    const did = input.did.trim();
    const existing = this.repository.get(did);
    if (existing) return existing;
    return this.addContact(input);
  }

  addContact(input: AddContactInput): Contact {
    const did = input.did.trim();
    if (!did) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'did is required');
    }
    if (!input.displayName.trim()) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'displayName is required');
    }

    const nowMs = Date.now();
    const existing = this.repository.get(did);
    const contact: Contact = {
      did,
      displayName: input.displayName.trim(),
      avatarUrl: input.avatarUrl,
      notes: input.notes,
      createdAtMs: existing?.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
    };
    this.repository.save(contact);
    return contact;
  }

  getContact(did: string): Contact | null {
    return this.repository.get(did.trim());
  }

  listContacts(): Contact[] {
    return this.repository.list();
  }

  updateContact(did: string, input: UpdateContactInput): Contact {
    const normalizedDid = did.trim();
    const existing = this.repository.get(normalizedDid);
    if (!existing) {
      throw new TelagentError(ErrorCodes.NOT_FOUND, `Contact not found: ${normalizedDid}`);
    }

    const updated: Contact = {
      ...existing,
      displayName: input.displayName?.trim() || existing.displayName,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : existing.avatarUrl,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      updatedAtMs: Date.now(),
    };
    this.repository.save(updated);
    return updated;
  }

  removeContact(did: string): boolean {
    return this.repository.remove(did.trim());
  }
}
