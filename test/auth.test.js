'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { cleanCredential, credentialsMatch } = require('../auth');

test('cleanCredential accepts Railway-style quoted values', () => {
  assert.equal(cleanCredential('"owner"'), 'owner');
  assert.equal(cleanCredential("'owner'"), 'owner');
  assert.equal(cleanCredential('  owner  '), 'owner');
});

test('credentialsMatch accepts the configured owner login', () => {
  assert.equal(credentialsMatch({
    submittedUsername: 'owner',
    submittedPassword: 'Instyle2026Test',
    ownerUsername: 'owner',
    passwordHash: 'valid-hash',
    verifyPassword: (password, hash) => password === 'Instyle2026Test' && hash === 'valid-hash'
  }), true);
});

test('credentialsMatch rejects either incorrect field', () => {
  const base = {
    ownerUsername: 'owner',
    passwordHash: 'valid-hash',
    verifyPassword: password => password === 'Instyle2026Test'
  };
  assert.equal(credentialsMatch({ ...base, submittedUsername: 'wrong', submittedPassword: 'Instyle2026Test' }), false);
  assert.equal(credentialsMatch({ ...base, submittedUsername: 'owner', submittedPassword: 'wrong' }), false);
});
