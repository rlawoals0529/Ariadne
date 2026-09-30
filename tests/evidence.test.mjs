import assert from 'node:assert/strict';
import test from 'node:test';
import { apiIdentityVerdict, classifyHttpFailure } from '../.test-dist/worker/evidence.js';

test('found requires an identifier match', () => {
  const verdict = apiIdentityVerdict({ httpStatus: 200, expected: 'alice', actual: 'Alice' });
  assert.equal(verdict.status, 'FOUND');
  assert.equal(verdict.confidence, 'high');
});

test('case-sensitive sources do not normalize identity mismatches', () => {
  const verdict = apiIdentityVerdict({ httpStatus: 200, expected: 'alice', actual: 'Alice', caseSensitive: true });
  assert.equal(verdict.status, 'UNKNOWN');
});

test('200 with a different identity is unknown, never found', () => {
  const verdict = apiIdentityVerdict({ httpStatus: 200, expected: 'alice', actual: 'bob' });
  assert.equal(verdict.status, 'UNKNOWN');
});

test('explicit missing API response is not found', () => {
  const verdict = apiIdentityVerdict({ httpStatus: 200, expected: 'alice', missing: true });
  assert.equal(verdict.status, 'NOT_FOUND');
});

test('rate limiting is blocked, never absence', () => {
  const verdict = classifyHttpFailure(429);
  assert.equal(verdict?.status, 'BLOCKED');
});

test('upstream server errors stay unknown', () => {
  const verdict = classifyHttpFailure(503);
  assert.equal(verdict?.status, 'UNKNOWN');
});
