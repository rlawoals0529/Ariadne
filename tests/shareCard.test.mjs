import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFriendShareCardSvg } from '../.test-dist/shareCard.js';

function metrics(overrides = {}) {
  return {
    participants: [
      { query: 'alice&co', confirmed: 3, possible: 2, trail: 5, unique: ['A'], categories: [['developer', 2]] },
      { query: 'bob<dev>', confirmed: 2, possible: 1, trail: 3, unique: ['B'], categories: [['developer', 1]] },
    ],
    shared: ['GitHub', 'Reddit & Forums'],
    verifiedShared: ['GitHub'],
    everyoneSites: ['GitHub'],
    verifiedEveryoneSites: ['GitHub'],
    mostFound: ['alice&co'],
    mostUnique: ['alice&co', 'bob<dev>'],
    closestPair: null,
    internetTwins: null,
    mostDifferentPair: null,
    categoryPair: null,
    ...overrides,
  };
}

test('friend share card is factual and escapes scan text', () => {
  const svg = buildFriendShareCardSvg(metrics());
  assert.match(svg, /@alice&amp;co/);
  assert.match(svg, /@bob&lt;dev&gt;/);
  assert.match(svg, /Reddit &amp; Forums/);
  assert.match(svg, /2 public sites appeared for more than one username/);
  assert.match(svg, /1 Found for at least two/);
});

test('friend share card keeps the ownership caveat and avoids invented scoring', () => {
  const svg = buildFriendShareCardSvg(metrics({ shared: [], verifiedShared: [], everyoneSites: [] }));
  assert.match(svg, /not proof that accounts belong to the same person/);
  assert.doesNotMatch(svg, /risk score|identity score|confidence score/i);
  assert.match(svg, /No shared Found or Maybe sites appeared/);
});


test('long similar handles keep distinguishing suffixes', () => {
  const six = [
    'averylongusernameone',
    'averylongusernametwo',
    'averylongusernamethree',
    'averylongusernamefour',
    'averylongusernamefive',
    'averylongusernamesix',
  ].map((query) => ({ query, confirmed: 1, possible: 1, trail: 2, unique: [], categories: [] }));

  const svg = buildFriendShareCardSvg(metrics({ participants: six }));
  assert.match(svg, /@averylong…eone/);
  assert.match(svg, /@averylong…etwo/);
  assert.match(svg, /@averylong…hree/);
  assert.match(svg, /@averylong…four/);
  assert.match(svg, /@averylong…five/);
  assert.match(svg, /@averylong…esix/);
});
