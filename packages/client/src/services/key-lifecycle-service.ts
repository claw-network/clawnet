import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ErrorCodes, TelagentError, isDidClaw, type AgentDID } from '../protocol/index.js';

export type KeySuite = 'signal' | 'mls';
export type KeyLifecycleState = 'ACTIVE' | 'ROTATING' | 'REVOKED' | 'RECOVERED';

export interface KeyLifecycleClock {
  now(): number;
}

export interface KeyLifecycleRecord {
  did: AgentDID;
  suite: KeySuite;
  keyId: string;
  publicKey: string;
  state: KeyLifecycleState;
  createdAtMs: number;
  activatedAtMs: number;
  expiresAtMs?: number;
  rotationGraceUntilMs?: number;
  rotatedFromKeyId?: string;
  rotatedToKeyId?: string;
  revokedAtMs?: number;
  revokeReason?: string;
  recoveredAtMs?: number;
  recoveredFromKeyId?: string;
  recoveredToKeyId?: string;
}

export interface RegisterKeyInput {
  did: AgentDID;
  suite: KeySuite;
  keyId: string;
  publicKey: string;
  expiresAtMs?: number;
}

export interface RotateKeyInput {
  did: AgentDID;
  suite: KeySuite;
  fromKeyId: string;
  toKeyId: string;
  publicKey: string;
  gracePeriodSec?: number;
}

export interface RevokeKeyInput {
  did: AgentDID;
  suite: KeySuite;
  keyId: string;
  reason: string;
}

export interface RecoverKeyInput {
  did: AgentDID;
  suite: KeySuite;
  revokedKeyId: string;
  recoveredKeyId: string;
  publicKey: string;
}

export interface AssertKeyInput {
  did: AgentDID;
  suite: KeySuite;
  keyId: string;
  atMs?: number;
}

export interface KeyLifecycleServiceOptions {
  defaultSignalGraceSec?: number;
  defaultMlsGraceSec?: number;
  clock?: KeyLifecycleClock;
  keysDir?: string;
}

const SYSTEM_CLOCK: KeyLifecycleClock = {
  now: () => Date.now(),
};

export class KeyLifecycleService {
  private readonly recordByCompositeKey = new Map<string, KeyLifecycleRecord>();
  private readonly defaultSignalGraceSec: number;
  private readonly defaultMlsGraceSec: number;
  private readonly clock: KeyLifecycleClock;
  private readonly keysDir?: string;

  constructor(options: KeyLifecycleServiceOptions = {}) {
    this.defaultSignalGraceSec = Math.max(30, Math.floor(options.defaultSignalGraceSec ?? 3_600));
    this.defaultMlsGraceSec = Math.max(30, Math.floor(options.defaultMlsGraceSec ?? 600));
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.keysDir = options.keysDir;
  }

  async loadFromDisk(): Promise<void> {
    if (!this.keysDir) return;
    let entries: string[];
    try {
      entries = await readdir(this.keysDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(resolve(this.keysDir, name), 'utf-8');
        const record = JSON.parse(raw) as KeyLifecycleRecord;
        const key = this.compositeKey(record.did, record.suite, record.keyId);
        this.recordByCompositeKey.set(key, record);
      } catch {
        // skip corrupted files
      }
    }
  }

  private async persistRecord(record: KeyLifecycleRecord): Promise<void> {
    if (!this.keysDir) return;
    const fileName = `${record.keyId}.json`;
    await writeFile(resolve(this.keysDir, fileName), JSON.stringify(record, null, 2), 'utf-8');
  }

  private async deleteRecordFile(keyId: string): Promise<void> {
    if (!this.keysDir) return;
    try {
      await unlink(resolve(this.keysDir, `${keyId}.json`));
    } catch {
      // file may not exist
    }
  }

  registerKey(input: RegisterKeyInput): KeyLifecycleRecord {
    const normalized = this.normalizeRegisterInput(input);
    const compositeKey = this.compositeKey(normalized.did, normalized.suite, normalized.keyId);
    const existing = this.recordByCompositeKey.get(compositeKey);
    if (existing) {
      if (
        existing.publicKey !== normalized.publicKey
        || existing.expiresAtMs !== normalized.expiresAtMs
      ) {
        throw new TelagentError(
          ErrorCodes.CONFLICT,
          `keyId(${normalized.keyId}) already exists with a different payload`,
        );
      }
      return this.cloneRecord(existing);
    }

    const now = this.clock.now();
    const record: KeyLifecycleRecord = {
      did: normalized.did,
      suite: normalized.suite,
      keyId: normalized.keyId,
      publicKey: normalized.publicKey,
      state: 'ACTIVE',
      createdAtMs: now,
      activatedAtMs: now,
      expiresAtMs: normalized.expiresAtMs,
    };
    this.recordByCompositeKey.set(compositeKey, record);
    void this.persistRecord(record);
    return this.cloneRecord(record);
  }

  rotateKey(input: RotateKeyInput): { previous: KeyLifecycleRecord; current: KeyLifecycleRecord } {
    const normalized = this.normalizeRotateInput(input);
    const previous = this.requireRecord(normalized.did, normalized.suite, normalized.fromKeyId);
    if (previous.state !== 'ACTIVE' && previous.state !== 'ROTATING') {
      throw new TelagentError(
        ErrorCodes.CONFLICT,
        `keyId(${normalized.fromKeyId}) must be ACTIVE/ROTATING before rotation`,
      );
    }

    const graceSec =
      typeof normalized.gracePeriodSec === 'number'
        ? normalized.gracePeriodSec
        : normalized.suite === 'signal'
          ? this.defaultSignalGraceSec
          : this.defaultMlsGraceSec;
    const graceUntilMs = this.clock.now() + graceSec * 1000;

    previous.state = 'ROTATING';
    previous.rotationGraceUntilMs = graceUntilMs;
    previous.rotatedToKeyId = normalized.toKeyId;
    void this.persistRecord(previous);

    const nextCompositeKey = this.compositeKey(normalized.did, normalized.suite, normalized.toKeyId);
    const nextExisting = this.recordByCompositeKey.get(nextCompositeKey);
    if (nextExisting) {
      if (
        nextExisting.state !== 'ACTIVE'
        || nextExisting.rotatedFromKeyId !== normalized.fromKeyId
        || nextExisting.publicKey !== normalized.publicKey
      ) {
        throw new TelagentError(
          ErrorCodes.CONFLICT,
          `rotation target keyId(${normalized.toKeyId}) conflicts with existing lifecycle record`,
        );
      }
      return {
        previous: this.cloneRecord(previous),
        current: this.cloneRecord(nextExisting),
      };
    }

    const now = this.clock.now();
    const next: KeyLifecycleRecord = {
      did: normalized.did,
      suite: normalized.suite,
      keyId: normalized.toKeyId,
      publicKey: normalized.publicKey,
      state: 'ACTIVE',
      createdAtMs: now,
      activatedAtMs: now,
      rotatedFromKeyId: normalized.fromKeyId,
    };
    this.recordByCompositeKey.set(nextCompositeKey, next);
    void this.persistRecord(next);

    return {
      previous: this.cloneRecord(previous),
      current: this.cloneRecord(next),
    };
  }

  revokeKey(input: RevokeKeyInput): KeyLifecycleRecord {
    const normalized = this.normalizeRevokeInput(input);
    const record = this.requireRecord(normalized.did, normalized.suite, normalized.keyId);
    record.state = 'REVOKED';
    record.revokedAtMs = this.clock.now();
    record.revokeReason = normalized.reason;
    void this.persistRecord(record);
    return this.cloneRecord(record);
  }

  recoverKey(input: RecoverKeyInput): { revoked: KeyLifecycleRecord; recovered: KeyLifecycleRecord } {
    const normalized = this.normalizeRecoverInput(input);
    const revoked = this.requireRecord(normalized.did, normalized.suite, normalized.revokedKeyId);
    if (revoked.state !== 'REVOKED') {
      throw new TelagentError(
        ErrorCodes.CONFLICT,
        `keyId(${normalized.revokedKeyId}) must be REVOKED before recovery`,
      );
    }

    const recoveredComposite = this.compositeKey(normalized.did, normalized.suite, normalized.recoveredKeyId);
    if (this.recordByCompositeKey.has(recoveredComposite)) {
      throw new TelagentError(
        ErrorCodes.CONFLICT,
        `recovered keyId(${normalized.recoveredKeyId}) already exists`,
      );
    }

    revoked.state = 'RECOVERED';
    revoked.recoveredAtMs = this.clock.now();
    revoked.recoveredToKeyId = normalized.recoveredKeyId;
    void this.persistRecord(revoked);

    const now = this.clock.now();
    const recovered: KeyLifecycleRecord = {
      did: normalized.did,
      suite: normalized.suite,
      keyId: normalized.recoveredKeyId,
      publicKey: normalized.publicKey,
      state: 'ACTIVE',
      createdAtMs: now,
      activatedAtMs: now,
      recoveredFromKeyId: normalized.revokedKeyId,
    };
    this.recordByCompositeKey.set(recoveredComposite, recovered);
    void this.persistRecord(recovered);

    return {
      revoked: this.cloneRecord(revoked),
      recovered: this.cloneRecord(recovered),
    };
  }

  assertCanUseKey(input: AssertKeyInput): KeyLifecycleRecord {
    const normalized = this.normalizeAssertInput(input);
    const atMs = normalized.atMs ?? this.clock.now();
    const record = this.requireRecord(normalized.did, normalized.suite, normalized.keyId);

    if (typeof record.expiresAtMs === 'number' && atMs >= record.expiresAtMs) {
      throw new TelagentError(
        ErrorCodes.FORBIDDEN,
        `keyId(${record.keyId}) has expired`,
      );
    }

    if (record.state === 'ACTIVE') {
      return this.cloneRecord(record);
    }
    if (record.state === 'ROTATING') {
      if (typeof record.rotationGraceUntilMs === 'number' && atMs <= record.rotationGraceUntilMs) {
        return this.cloneRecord(record);
      }
      throw new TelagentError(
        ErrorCodes.FORBIDDEN,
        `keyId(${record.keyId}) is no longer usable after rotation grace window`,
      );
    }
    if (record.state === 'REVOKED') {
      throw new TelagentError(
        ErrorCodes.FORBIDDEN,
        `keyId(${record.keyId}) is revoked`,
      );
    }
    throw new TelagentError(
      ErrorCodes.FORBIDDEN,
      `keyId(${record.keyId}) is recovered and replaced by ${record.recoveredToKeyId ?? 'unknown'}`,
    );
  }

  listKeys(did: AgentDID, suite?: KeySuite): KeyLifecycleRecord[] {
    this.assertDid(did);
    if (suite) {
      this.assertSuite(suite);
    }
    return [...this.recordByCompositeKey.values()]
      .filter((record) => record.did === did && (!suite || record.suite === suite))
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .map((record) => this.cloneRecord(record));
  }

  private normalizeRegisterInput(input: RegisterKeyInput): RegisterKeyInput {
    this.assertDid(input.did);
    this.assertSuite(input.suite);
    this.assertKeyId(input.keyId, 'keyId');
    this.assertPublicKey(input.publicKey);
    if (typeof input.expiresAtMs === 'number' && (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= 0)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'expiresAtMs must be a positive number');
    }
    return {
      did: input.did,
      suite: input.suite,
      keyId: input.keyId.trim(),
      publicKey: input.publicKey.trim(),
      expiresAtMs: input.expiresAtMs,
    };
  }

  private normalizeRotateInput(input: RotateKeyInput): RotateKeyInput {
    this.assertDid(input.did);
    this.assertSuite(input.suite);
    this.assertKeyId(input.fromKeyId, 'fromKeyId');
    this.assertKeyId(input.toKeyId, 'toKeyId');
    this.assertPublicKey(input.publicKey);
    if (input.fromKeyId.trim() === input.toKeyId.trim()) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'toKeyId must be different from fromKeyId');
    }
    if (typeof input.gracePeriodSec !== 'undefined') {
      if (!Number.isInteger(input.gracePeriodSec) || input.gracePeriodSec <= 0) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'gracePeriodSec must be a positive integer');
      }
    }
    return {
      did: input.did,
      suite: input.suite,
      fromKeyId: input.fromKeyId.trim(),
      toKeyId: input.toKeyId.trim(),
      publicKey: input.publicKey.trim(),
      gracePeriodSec: input.gracePeriodSec,
    };
  }

  private normalizeRevokeInput(input: RevokeKeyInput): RevokeKeyInput {
    this.assertDid(input.did);
    this.assertSuite(input.suite);
    this.assertKeyId(input.keyId, 'keyId');
    if (typeof input.reason !== 'string' || !input.reason.trim()) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'reason is required');
    }
    return {
      did: input.did,
      suite: input.suite,
      keyId: input.keyId.trim(),
      reason: input.reason.trim(),
    };
  }

  private normalizeRecoverInput(input: RecoverKeyInput): RecoverKeyInput {
    this.assertDid(input.did);
    this.assertSuite(input.suite);
    this.assertKeyId(input.revokedKeyId, 'revokedKeyId');
    this.assertKeyId(input.recoveredKeyId, 'recoveredKeyId');
    this.assertPublicKey(input.publicKey);
    if (input.revokedKeyId.trim() === input.recoveredKeyId.trim()) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'recoveredKeyId must be different from revokedKeyId');
    }
    return {
      did: input.did,
      suite: input.suite,
      revokedKeyId: input.revokedKeyId.trim(),
      recoveredKeyId: input.recoveredKeyId.trim(),
      publicKey: input.publicKey.trim(),
    };
  }

  private normalizeAssertInput(input: AssertKeyInput): AssertKeyInput {
    this.assertDid(input.did);
    this.assertSuite(input.suite);
    this.assertKeyId(input.keyId, 'keyId');
    if (typeof input.atMs !== 'undefined' && (!Number.isFinite(input.atMs) || input.atMs <= 0)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'atMs must be a positive number');
    }
    return {
      did: input.did,
      suite: input.suite,
      keyId: input.keyId.trim(),
      atMs: input.atMs,
    };
  }

  private compositeKey(did: AgentDID, suite: KeySuite, keyId: string): string {
    return `${did}:${suite}:${keyId}`;
  }

  private requireRecord(did: AgentDID, suite: KeySuite, keyId: string): KeyLifecycleRecord {
    const record = this.recordByCompositeKey.get(this.compositeKey(did, suite, keyId));
    if (!record) {
      throw new TelagentError(
        ErrorCodes.NOT_FOUND,
        `keyId(${keyId}) not found for did(${did}) suite(${suite})`,
      );
    }
    return record;
  }

  private assertDid(did: string): asserts did is AgentDID {
    if (!isDidClaw(did)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'did must use did:claw format');
    }
  }

  private assertSuite(suite: string): asserts suite is KeySuite {
    if (suite !== 'signal' && suite !== 'mls') {
      throw new TelagentError(ErrorCodes.VALIDATION, 'suite must be signal or mls');
    }
  }

  private assertKeyId(value: string, field: string): void {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TelagentError(ErrorCodes.VALIDATION, `${field} is required`);
    }
    if (!/^[A-Za-z0-9._:-]{3,128}$/.test(value.trim())) {
      throw new TelagentError(ErrorCodes.VALIDATION, `${field} is not a valid key identifier`);
    }
  }

  private assertPublicKey(value: string): void {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'publicKey is required');
    }
    if (!/^0x[0-9a-fA-F]{16,}$/.test(value.trim())) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'publicKey must be a hex string');
    }
  }

  private cloneRecord(record: KeyLifecycleRecord): KeyLifecycleRecord {
    return { ...record };
  }
}
