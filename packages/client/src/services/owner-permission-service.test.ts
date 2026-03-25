import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OwnerPermissionService,
  parseOwnerMode,
  parseOwnerScopes,
  parsePrivateConversations,
} from './owner-permission-service.js';

test('owner permission service returns normalized permission payload', () => {
  const service = new OwnerPermissionService({
    mode: 'intervener',
    interventionScopes: ['send_message', 'manage_groups', 'manage_groups'],
    privateConversations: [' direct:a ', '', 'group:b'],
  });

  const permissions = service.getPermissions();
  assert.equal(permissions.mode, 'intervener');
  assert.deepEqual(permissions.interventionScopes, ['send_message', 'manage_groups']);
  assert.deepEqual(permissions.privateConversations, ['direct:a', 'group:b']);
  assert.equal(service.isPrivateConversation('group:b'), true);
  assert.equal(service.isPrivateConversation('group:c'), false);
});

test('owner permission parsers enforce allowed values', () => {
  assert.equal(parseOwnerMode(undefined), 'observer');
  assert.equal(parseOwnerMode('intervener'), 'intervener');
  assert.throws(() => parseOwnerMode('admin'), /must be observer or intervener/);

  assert.deepEqual(parseOwnerScopes(undefined), []);
  assert.deepEqual(parseOwnerScopes('send_message,manage_groups'), ['send_message', 'manage_groups']);
  assert.throws(() => parseOwnerScopes('send_message,invalid'), /unsupported scope/);

  assert.deepEqual(parsePrivateConversations(undefined), []);
  assert.deepEqual(parsePrivateConversations(' direct:a , group:b '), ['direct:a', 'group:b']);
});
