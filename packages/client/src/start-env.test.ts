import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  loadRequiredTelagentEnvFile,
  requireTelagentEnvFile,
  resolveBundledMkcertPath,
  resolveDefaultNodeExtraCaCerts,
  resolveStartupTelagentHome,
  resolveTelagentEnvFile,
  validateLoadedTelagentHome,
} from './start-env.js';

test('resolveStartupTelagentHome defaults to ~/.telagent on posix paths', () => {
  assert.equal(
    resolveStartupTelagentHome('/Users/alex', undefined, path.posix),
    '/Users/alex/.telagent',
  );
});

test('resolveTelagentEnvFile defaults to ~/.telagent/.env on posix paths', () => {
  assert.equal(
    resolveTelagentEnvFile('/Users/alex', undefined, path.posix),
    '/Users/alex/.telagent/.env',
  );
});

test('resolveTelagentEnvFile uses shell TELAGENT_HOME when provided', () => {
  assert.equal(
    resolveTelagentEnvFile('/Users/alex', '/tmp/custom-home', path.posix),
    '/tmp/custom-home/.env',
  );
});

test('resolveTelagentEnvFile defaults to ~/.telagent/.env on win32 paths', () => {
  assert.equal(
    resolveTelagentEnvFile('C:\\Users\\alex', undefined, path.win32),
    'C:\\Users\\alex\\.telagent\\.env',
  );
});

test('requireTelagentEnvFile rejects missing $TELAGENT_HOME/.env', () => {
  assert.throws(
    () => requireTelagentEnvFile('/Users/alex/.telagent/.env', () => false),
    /Missing required env file at .*Create \$TELAGENT_HOME\/\.env before starting the node\./,
  );
});

test('loadRequiredTelagentEnvFile loads the required $TELAGENT_HOME/.env path', () => {
  let loadedFilePath: string | undefined;

  const envFile = loadRequiredTelagentEnvFile(
    '/Users/alex/.telagent/.env',
    () => true,
    (filePath: string) => {
      loadedFilePath = filePath;
    },
    '/Users/alex/.telagent',
  );

  assert.equal(envFile, '/Users/alex/.telagent/.env');
  assert.equal(loadedFilePath, '/Users/alex/.telagent/.env');
});

test('validateLoadedTelagentHome rejects TELAGENT_HOME that points to a different env directory', () => {
  assert.throws(
    () => validateLoadedTelagentHome(
      '/Users/alex/.telagent',
      '/Users/alex/.telagent/.env',
      '/tmp/custom-home',
      path.posix,
    ),
    /Env file location must follow TELAGENT_HOME/,
  );
});

test('resolveBundledMkcertPath follows $TELAGENT_HOME/bin', () => {
  assert.equal(
    resolveBundledMkcertPath('/Users/alex/.telagent', 'darwin', path.posix),
    '/Users/alex/.telagent/bin/mkcert',
  );
  assert.equal(
    resolveBundledMkcertPath('C:\\Users\\alex\\custom-home', 'win32', path.win32),
    'C:\\Users\\alex\\custom-home\\bin\\mkcert.exe',
  );
});

test('resolveDefaultNodeExtraCaCerts prefers bundled mkcert under $TELAGENT_HOME/bin', () => {
  const calls: string[] = [];
  const exists = (filePath: string): boolean =>
    filePath === '/tmp/custom-home/bin/mkcert'
    || filePath === '/Users/alex/.local/share/mkcert/rootCA.pem';

  const caFile = resolveDefaultNodeExtraCaCerts(
    '/tmp/custom-home',
    'darwin',
    exists,
    (file: string) => {
      calls.push(file);
      return '/Users/alex/.local/share/mkcert\n';
    },
    path.posix,
  );

  assert.equal(caFile, '/Users/alex/.local/share/mkcert/rootCA.pem');
  assert.deepEqual(calls, ['/tmp/custom-home/bin/mkcert']);
});
