/**
 * DID cache indexer tests.
 *
 * Verifies that `upsertDid()` preserves controller and active_key
 * when empty strings are passed (e.g. KeyRotated only updates key,
 * DIDRevoked only updates is_active).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexerStore } from '../src/indexer/store.js';

describe('DID cache indexer materialisation', () => {
  let store: IndexerStore;

  beforeEach(() => {
    store = new IndexerStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  const DID_HASH = '0x' + 'dd'.repeat(32);
  const CONTROLLER = '0x' + 'aa'.repeat(20);
  const KEY_1 = 'key-ed25519-original';
  const KEY_2 = 'key-ed25519-rotated';

  function getDid() {
    return store.database
      .prepare('SELECT * FROM did_cache WHERE did_hash = ?')
      .get(DID_HASH) as {
      did_hash: string;
      controller: string;
      active_key: string;
      is_active: number;
      updated_at: number;
    } | undefined;
  }

  it('DIDRegistered inserts full record', () => {
    store.upsertDid(DID_HASH, CONTROLLER, KEY_1, true, 1000);

    const row = getDid();
    expect(row).toBeDefined();
    expect(row!.controller).toBe(CONTROLLER);
    expect(row!.active_key).toBe(KEY_1);
    expect(row!.is_active).toBe(1);
  });

  it('KeyRotated preserves controller when empty string passed', () => {
    // Register
    store.upsertDid(DID_HASH, CONTROLLER, KEY_1, true, 1000);

    // Key rotation — controller passed as '' (unchanged)
    store.upsertDid(DID_HASH, '', KEY_2, true, 2000);

    const row = getDid();
    expect(row!.controller).toBe(CONTROLLER); // preserved!
    expect(row!.active_key).toBe(KEY_2); // updated
    expect(row!.is_active).toBe(1);
    expect(row!.updated_at).toBe(2000);
  });

  it('DIDRevoked preserves controller and key when empty strings passed', () => {
    // Register
    store.upsertDid(DID_HASH, CONTROLLER, KEY_1, true, 1000);

    // Revoke — controller and key passed as '' (unchanged)
    store.upsertDid(DID_HASH, '', '', false, 3000);

    const row = getDid();
    expect(row!.controller).toBe(CONTROLLER); // preserved!
    expect(row!.active_key).toBe(KEY_1); // preserved!
    expect(row!.is_active).toBe(0); // updated to revoked
    expect(row!.updated_at).toBe(3000);
  });

  it('full lifecycle: Register → KeyRotate → Revoke preserves controller', () => {
    // Register
    store.upsertDid(DID_HASH, CONTROLLER, KEY_1, true, 1000);
    expect(getDid()!.controller).toBe(CONTROLLER);

    // Key rotate
    store.upsertDid(DID_HASH, '', KEY_2, true, 2000);
    expect(getDid()!.controller).toBe(CONTROLLER);
    expect(getDid()!.active_key).toBe(KEY_2);

    // Revoke
    store.upsertDid(DID_HASH, '', '', false, 3000);
    expect(getDid()!.controller).toBe(CONTROLLER);
    expect(getDid()!.active_key).toBe(KEY_2);
    expect(getDid()!.is_active).toBe(0);
  });

  it('controller can be explicitly updated to a new value', () => {
    store.upsertDid(DID_HASH, CONTROLLER, KEY_1, true, 1000);

    const NEW_CONTROLLER = '0x' + 'ff'.repeat(20);
    store.upsertDid(DID_HASH, NEW_CONTROLLER, '', true, 2000);

    const row = getDid();
    expect(row!.controller).toBe(NEW_CONTROLLER); // updated to new value
    expect(row!.active_key).toBe(KEY_1); // preserved (empty string)
  });
});
