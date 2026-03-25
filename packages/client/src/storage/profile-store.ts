import { readFile, writeFile } from 'node:fs/promises';

import type { SelfProfile } from '../protocol/index.js';

import type { TelagentStoragePaths } from './telagent-paths.js';

/**
 * Internal storage format — extends SelfProfile with the avatar MIME type
 * so we can serve the avatar binary with the correct Content-Type.
 */
interface ProfileRecord extends SelfProfile {
  avatarMimeType?: string;
}

export class SelfProfileStore {
  private readonly profileFile: string;
  private readonly avatarFile: string;

  constructor(paths: Pick<TelagentStoragePaths, 'profileFile' | 'avatarFile'>) {
    this.profileFile = paths.profileFile;
    this.avatarFile = paths.avatarFile;
  }

  /** Load the stored profile. Returns null if no profile has been saved yet. */
  async load(): Promise<ProfileRecord | null> {
    try {
      const raw = await readFile(this.profileFile, 'utf8');
      return JSON.parse(raw) as ProfileRecord;
    } catch {
      return null;
    }
  }

  /** Persist the profile. Pass-through fields not listed here are preserved. */
  async save(update: Partial<ProfileRecord>): Promise<ProfileRecord> {
    const existing = (await this.load()) ?? {};
    const merged: ProfileRecord = { ...existing, ...update };
    await writeFile(this.profileFile, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  }

  /** Save avatar binary and update profile's avatarMimeType. */
  async saveAvatar(data: Buffer, mimeType: string): Promise<void> {
    await writeFile(this.avatarFile, data);
    await this.save({ avatarUrl: '/api/v1/profile/avatar', avatarMimeType: mimeType });
  }

  /**
   * Load avatar binary + MIME type.
   * Returns null if no avatar has been uploaded.
   */
  async loadAvatar(): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const [data, record] = await Promise.all([
        readFile(this.avatarFile),
        this.load(),
      ]);
      if (!data || !record?.avatarMimeType) {
        return null;
      }
      return { data, mimeType: record.avatarMimeType };
    } catch {
      return null;
    }
  }

  /**
   * Returns the public-facing SelfProfile (strips internal fields like avatarMimeType).
   * Returns empty object if nothing has been configured.
   */
  async loadPublic(): Promise<SelfProfile> {
    const record = await this.load();
    if (!record) {
      return {};
    }
    const { avatarMimeType: _stripped, ...profile } = record;
    return profile;
  }
}
