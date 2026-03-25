import assert from 'node:assert/strict';
import test from 'node:test';

import { ErrorCodes, TelagentError } from '../protocol/index.js';

import { AttachmentService } from './attachment-service.js';

interface MutableClock {
  now(): number;
  tick(ms: number): void;
}

function createClock(startMs = 10_000): MutableClock {
  let current = startMs;
  return {
    now() {
      return current;
    },
    tick(ms: number) {
      current += ms;
    },
  };
}

function createService(startMs?: number) {
  const clock = createClock(startMs);
  return {
    clock,
    service: new AttachmentService({ clock }),
  };
}

test('TA-P4-006 init-upload sanitizes filename and emits attachment objectKey', () => {
  const { service } = createService();
  const session = service.initUpload({
    filename: '../unsafe file?.png',
    contentType: 'image/png',
    sizeBytes: 1024,
    manifestHash: `0x${'a'.repeat(64)}`,
  });

  assert.match(session.objectKey, /^attachments\/\d+-/);
  assert.ok(session.objectKey.endsWith('-unsafe_file_.png'));
  assert.equal(session.expiresInSec, 900);
});

test('TA-P4-006 complete-upload enforces manifest and checksum integrity', () => {
  const { service } = createService();
  const manifestHash = `0x${'b'.repeat(64)}`;
  const checksum = `0x${'c'.repeat(64)}`;
  const session = service.initUpload({
    filename: 'safe.png',
    contentType: 'image/png',
    sizeBytes: 2048,
    manifestHash,
  });

  assert.throws(
    () =>
      service.completeUpload({
        objectKey: session.objectKey,
        manifestHash,
        checksum: '0x12',
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.VALIDATION);
      return true;
    },
  );

  const result = service.completeUpload({
    objectKey: session.objectKey,
    manifestHash,
    checksum,
  });
  assert.equal(result.checksum, checksum);
});

test('TA-P4-006 complete-upload is idempotent and rejects checksum divergence', () => {
  const { service } = createService();
  const manifestHash = `0x${'d'.repeat(64)}`;
  const checksum = `0x${'e'.repeat(64)}`;
  const session = service.initUpload({
    filename: 'file.bin',
    contentType: 'application/octet-stream',
    sizeBytes: 4096,
    manifestHash,
  });

  const first = service.completeUpload({
    objectKey: session.objectKey,
    manifestHash,
    checksum,
  });
  const second = service.completeUpload({
    objectKey: session.objectKey,
    manifestHash,
    checksum,
  });

  assert.equal(second.checksum, first.checksum);
  assert.equal(second.completedAtMs, first.completedAtMs);

  assert.throws(
    () =>
      service.completeUpload({
        objectKey: session.objectKey,
        manifestHash,
        checksum: `0x${'f'.repeat(64)}`,
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.CONFLICT);
      return true;
    },
  );
});

test('TA-P4-006 expired upload sessions are cleaned and cannot be completed', () => {
  const { service, clock } = createService(100);
  const manifestHash = `0x${'1'.repeat(64)}`;
  const checksum = `0x${'2'.repeat(64)}`;
  const session = service.initUpload({
    filename: 'expired.txt',
    contentType: 'text/plain',
    sizeBytes: 128,
    manifestHash,
  });

  clock.tick(901_000);
  const removed = service.cleanupExpiredSessions(clock.now());
  assert.equal(removed, 1);

  assert.throws(
    () =>
      service.completeUpload({
        objectKey: session.objectKey,
        manifestHash,
        checksum,
      }),
    (error) => {
      assert.ok(error instanceof TelagentError);
      assert.equal(error.code, ErrorCodes.NOT_FOUND);
      return true;
    },
  );
});
