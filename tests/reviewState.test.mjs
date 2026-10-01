import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearAccountReviews,
  normalizeAccountReviews,
  readAccountReviews,
  reviewStorageKey,
  updateAccountReview,
  writeAccountReviews,
} from '../.test-dist/reviewState.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

test('review storage keys are scoped to a normalized username', () => {
  assert.equal(reviewStorageKey(' Alice '), reviewStorageKey('alice'));
  assert.notEqual(reviewStorageKey('alice'), reviewStorageKey('bob'));
});

test('review updates keep ownership user-controlled and clear actions when ownership changes', () => {
  let state = {};
  state = updateAccountReview(state, 'github', { ownership: 'mine' }, '2026-09-30T20:00:00.000Z');
  state = updateAccountReview(state, 'github', { action: 'cleanup' }, '2026-09-30T20:01:00.000Z');
  assert.equal(state.github.ownership, 'mine');
  assert.equal(state.github.action, 'cleanup');

  state = updateAccountReview(state, 'github', { ownership: 'not-mine' }, '2026-09-30T20:02:00.000Z');
  assert.equal(state.github.ownership, 'not-mine');
  assert.equal(state.github.action, undefined);
});

test('clearing a review removes the source record', () => {
  let state = updateAccountReview({}, 'reddit', { ownership: 'unsure' }, '2026-09-30T20:00:00.000Z');
  state = updateAccountReview(state, 'reddit', { ownership: null }, '2026-09-30T20:01:00.000Z');
  assert.deepEqual(state, {});
});

test('stored review state survives a local round trip', () => {
  const storage = memoryStorage();
  const state = {
    github: { ownership: 'mine', action: 'keep', updatedAt: '2026-09-30T20:00:00.000Z' },
    reddit: { ownership: 'unsure', updatedAt: '2026-09-30T20:01:00.000Z' },
  };

  writeAccountReviews(storage, 'Alice', state);
  assert.deepEqual(readAccountReviews(storage, 'alice'), state);

  clearAccountReviews(storage, 'alice');
  assert.deepEqual(readAccountReviews(storage, 'alice'), {});
});

test('normalization rejects unsupported ownership and actions', () => {
  assert.deepEqual(normalizeAccountReviews({
    github: { ownership: 'mine', action: 'cleanup', updatedAt: 'x' },
    reddit: { ownership: 'probably-mine', action: 'done', updatedAt: 'x' },
    twitch: { ownership: 'unsure', action: 'cleanup', updatedAt: 'x' },
  }), {
    github: { ownership: 'mine', action: 'cleanup', updatedAt: 'x' },
    twitch: { ownership: 'unsure', updatedAt: 'x' },
  });
});
