import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfigFromEnv } from './config.js';

const BASE_ENV: Record<string, string> = {
  TELAGENT_API_HOST: '127.0.0.1',
  TELAGENT_API_PORT: '9528',
  TELAGENT_HOME: '.telagent-config-test',
  TELAGENT_CHAIN_RPC_URL: 'http://127.0.0.1:8545',
  TELAGENT_CHAIN_ID: '7625',
  TELAGENT_GROUP_REGISTRY_CONTRACT: '0x3333333333333333333333333333333333333333',
  TELAGENT_SIGNER_TYPE: 'env',
  TELAGENT_SIGNER_ENV: 'TELAGENT_PRIVATE_KEY',
  TELAGENT_PRIVATE_KEY: '0x' + '1'.repeat(64),
};

const DEPRECATED_ENV_KEYS = [
  'TELAGENT_DATA_DIR',
  'TELAGENT_SELF_DID',
  'TELAGENT_IDENTITY_CONTRACT',
  'TELAGENT_TOKEN_CONTRACT',
] as const;

async function withEnv<T>(overrides: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
  const keys = new Set<string>([
    ...Object.keys(BASE_ENV),
    ...Object.keys(overrides),
    ...DEPRECATED_ENV_KEYS,
  ]);
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
  }

  for (const key of DEPRECATED_ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(BASE_ENV)) {
    process.env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('mailbox store defaults to sqlite backend', async () => {
  await withEnv(
    {
      TELAGENT_MAILBOX_STORE_BACKEND: undefined,
      TELAGENT_MAILBOX_SQLITE_PATH: undefined,
    },
    async () => {
      const config = loadConfigFromEnv();
      assert.equal(config.mailboxStore.backend, 'sqlite');
      assert.match(config.mailboxStore.sqlitePath, /mailbox\.sqlite$/);
      assert.equal(config.mailboxStore.postgres, undefined);
    },
  );
});

test('owner config defaults to observer mode', async () => {
  await withEnv(
    {
      TELAGENT_OWNER_MODE: undefined,
      TELAGENT_OWNER_SCOPES: undefined,
      TELAGENT_OWNER_PRIVATE_CONVERSATIONS: undefined,
    },
    async () => {
      const config = loadConfigFromEnv();
      assert.equal(config.owner.mode, 'observer');
      assert.deepEqual(config.owner.scopes, []);
      assert.deepEqual(config.owner.privateConversations, []);
    },
  );
});

test('owner config parses intervener scopes and private conversations', async () => {
  await withEnv(
    {
      TELAGENT_OWNER_MODE: 'intervener',
      TELAGENT_OWNER_SCOPES: 'send_message,manage_groups,clawnet_market',
      TELAGENT_OWNER_PRIVATE_CONVERSATIONS: 'direct:a,group:b',
    },
    async () => {
      const config = loadConfigFromEnv();
      assert.equal(config.owner.mode, 'intervener');
      assert.deepEqual(config.owner.scopes, ['send_message', 'manage_groups', 'clawnet_market']);
      assert.deepEqual(config.owner.privateConversations, ['direct:a', 'group:b']);
    },
  );
});

test('owner config rejects unsupported scope', async () => {
  await withEnv(
    {
      TELAGENT_OWNER_MODE: 'intervener',
      TELAGENT_OWNER_SCOPES: 'send_message,unknown_scope',
    },
    async () => {
      assert.throws(
        () => loadConfigFromEnv(),
        /unsupported scope/,
      );
    },
  );
});

test('mailbox store parses postgres backend config', async () => {
  await withEnv(
    {
      TELAGENT_MAILBOX_STORE_BACKEND: 'postgres',
      TELAGENT_MAILBOX_PG_URL: 'postgres://user:password@127.0.0.1:5432/telagent',
      TELAGENT_MAILBOX_PG_SCHEMA: 'telagent_mailbox',
      TELAGENT_MAILBOX_PG_SSL: 'true',
      TELAGENT_MAILBOX_PG_MAX_CONN: '16',
    },
    async () => {
      const config = loadConfigFromEnv();
      assert.equal(config.mailboxStore.backend, 'postgres');
      assert.equal(config.mailboxStore.postgres?.connectionString, 'postgres://user:password@127.0.0.1:5432/telagent');
      assert.equal(config.mailboxStore.postgres?.schema, 'telagent_mailbox');
      assert.equal(config.mailboxStore.postgres?.ssl, true);
      assert.equal(config.mailboxStore.postgres?.maxConnections, 16);
    },
  );
});

test('postgres backend requires connection url', async () => {
  await withEnv(
    {
      TELAGENT_MAILBOX_STORE_BACKEND: 'postgres',
      TELAGENT_MAILBOX_PG_URL: undefined,
    },
    async () => {
      assert.throws(
        () => loadConfigFromEnv(),
        /TELAGENT_MAILBOX_PG_URL is required/,
      );
    },
  );
});

test('mailbox backend rejects unsupported value', async () => {
  await withEnv(
    {
      TELAGENT_MAILBOX_STORE_BACKEND: 'redis',
    },
    async () => {
      assert.throws(
        () => loadConfigFromEnv(),
        /TELAGENT_MAILBOX_STORE_BACKEND must be sqlite or postgres/,
      );
    },
  );
});

test('deprecated TELAGENT_DATA_DIR is rejected', async () => {
  await withEnv(
    {
      TELAGENT_DATA_DIR: '.legacy-data-dir',
    },
    async () => {
      assert.throws(
        () => loadConfigFromEnv(),
        /TELAGENT_DATA_DIR is removed\. Use TELAGENT_HOME instead\./,
      );
    },
  );
});

test('deprecated TELAGENT_SELF_DID is rejected', async () => {
  await withEnv(
    {
      TELAGENT_SELF_DID: 'did:claw:zLegacy',
    },
    async () => {
      assert.throws(
        () => loadConfigFromEnv(),
        /TELAGENT_SELF_DID is removed\. DID is now obtained from ClawNet Node automatically\./,
      );
    },
  );
});

test('deprecated TELAGENT_IDENTITY_CONTRACT is rejected', async () => {
  await withEnv(
    {
      TELAGENT_IDENTITY_CONTRACT: '0x1111111111111111111111111111111111111111',
    },
    async () => {
      assert.throws(
        () => loadConfigFromEnv(),
        /TELAGENT_IDENTITY_CONTRACT is removed\. Identity is now resolved via ClawNet SDK\./,
      );
    },
  );
});

test('deprecated TELAGENT_TOKEN_CONTRACT is rejected', async () => {
  await withEnv(
    {
      TELAGENT_TOKEN_CONTRACT: '0x2222222222222222222222222222222222222222',
    },
    async () => {
      assert.throws(
        () => loadConfigFromEnv(),
        /TELAGENT_TOKEN_CONTRACT is removed\. Token balance is now queried via ClawNet SDK\./,
      );
    },
  );
});
