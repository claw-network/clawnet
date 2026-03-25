import assert from 'node:assert/strict';
import test from 'node:test';

import { hashDid, isDidClaw } from './hash.js';

test('isDidClaw validates did:claw format', () => {
  assert.equal(isDidClaw('did:claw:z6Mkabc123'), true);
  assert.equal(isDidClaw('did:example:abc'), false);
});

test('hashDid is deterministic bytes32 hex', () => {
  const did = 'did:claw:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' as const;
  const first = hashDid(did);
  const second = hashDid(did);
  assert.equal(first, second);
  assert.match(first, /^0x[0-9a-f]{64}$/);
});
