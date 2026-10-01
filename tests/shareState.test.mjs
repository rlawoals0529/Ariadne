import assert from 'node:assert/strict';
import test from 'node:test';

import { buildShareHash, parseShareHash } from '../.test-dist/shareState.js';

test('solo setup links round-trip without starting a scan', () => {
  const hash = buildShareHash('solo', ['Example_User'], false);
  assert.equal(hash, '#setup?mode=solo&u=Example_User');
  assert.deepEqual(parseShareHash(hash), {
    mode: 'solo',
    usernames: ['Example_User'],
    includeNsfw: false,
  });
});

test('friend setup links preserve up to six unique usernames', () => {
  const hash = buildShareHash('party', ['Alice', 'bob', 'CHARLIE'], true);
  assert.deepEqual(parseShareHash(hash), {
    mode: 'party',
    usernames: ['Alice', 'bob', 'CHARLIE'],
    includeNsfw: true,
  });
});

test('shared setup removes duplicates and rejects invalid input', () => {
  assert.equal(buildShareHash('party', ['Alice', 'alice'], false), '');
  assert.equal(buildShareHash('solo', ['not valid!'], false), '');
  assert.equal(parseShareHash('#setup?mode=party&u=one'), null);
  assert.equal(parseShareHash('#setup?mode=solo&u='), null);
  assert.equal(parseShareHash('#something-else'), null);
});

test('shared setup rejects more than six friend usernames', () => {
  const names = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  assert.equal(buildShareHash('party', names, false), '');
});
