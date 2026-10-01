import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const errors = [];
const checkedAt = new Date().toISOString();

const fixtureResults = [
  ['github','GitHub','developer','FOUND','direct-api'],
  ['gitlab','GitLab','developer','POSSIBLE','catalog-rule'],
  ['steam','Steam','gaming','FOUND','direct-api'],
  ['itch','itch.io','gaming','POSSIBLE','catalog-rule'],
  ['reddit','Reddit','community','FOUND','direct-api'],
  ['forum','Example Forum','community','POSSIBLE','catalog-rule'],
  ['twitch','Twitch','media','FOUND','direct-api'],
  ['letterboxd','Letterboxd','media','POSSIBLE','catalog-rule'],
  ['behance','Behance','creative','FOUND','direct-api'],
  ['artstation','ArtStation','creative','POSSIBLE','catalog-rule'],
  ['mastodon','Mastodon','social','FOUND','direct-api'],
  ['spacehey','SpaceHey','social','POSSIBLE','catalog-rule'],
  ['blocked','Blocked Example','other','BLOCKED','catalog-rule'],
  ['missing','Missing Example','developer','NOT_FOUND','direct-api'],
].map(([sourceId, sourceName, category, status, evidenceBasis], index) => ({
  sourceId, sourceName, category, status, evidenceBasis,
  profileUrl: 'https://example.com/' + sourceId + '/fixture_user',
  nsfw: false,
  confidence: status === 'FOUND' || status === 'NOT_FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : 'none',
  reason: status === 'FOUND' ? 'Canonical username matched.' : status === 'POSSIBLE' ? 'Representative public profile page.' : status === 'NOT_FOUND' ? 'Exact lookup returned no profile.' : 'Representative blocked response.',
  httpStatus: status === 'BLOCKED' ? 403 : status === 'NOT_FOUND' ? 404 : 200,
  checkedAt,
  durationMs: 90 + index * 13,
  signals: [{ kind: status === 'FOUND' ? 'identity' : status === 'NOT_FOUND' ? 'negative' : status === 'BLOCKED' ? 'block' : 'provenance', detail: 'Friend-card visual QA fixture.' }],
}));

function summary(results) {
  const out = { FOUND:0, POSSIBLE:0, NOT_FOUND:0, UNKNOWN:0, BLOCKED:0, SKIPPED:0 };
  for (const result of results) out[result.status] += 1;
  return out;
}

function responseFor(query) {
  const results = fixtureResults.map((result) => ({
    ...result,
    profileUrl: result.profileUrl.replace('fixture_user', encodeURIComponent(query)),
  }));
  return {
    query,
    kind: 'username',
    checkedAt,
    sourceCount: results.length,
    batchCount: results.length,
    includeNsfw: false,
    nextCursor: null,
    results,
    summary: summary(results),
  };
}

const sourceStats = {
  total: 14,
  standard: 14,
  nsfw: 0,
  direct: 7,
  heuristic: 7,
  disabled: 0,
  sourceAvailability: [],
};

async function prepare(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(label + ' console: ' + message.text());
  });
  page.on('pageerror', (error) => errors.push(label + ' pageerror: ' + error.message));
  await page.route('**/api/sources', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(sourceStats),
  }));
  await page.route('**/api/search', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseFor(String(body.query || 'fixture_user'))),
    });
  });
}

async function openComparison(page, names, label) {
  const fragment = '#setup?mode=party&' + names.map((name) => 'u=' + encodeURIComponent(name)).join('&');
  await page.goto(url + '/' + fragment, { waitUntil: 'networkidle' });
  const values = await page.locator('.party-input-row input').evaluateAll((elements) => elements.map((element) => element.value));
  if (JSON.stringify(values) !== JSON.stringify(names)) errors.push(label + ' setup mismatch: ' + JSON.stringify(values));
  if (await page.evaluate(() => location.hash)) errors.push(label + ' setup fragment was not cleared');
  if (await page.locator('.party-report').count()) errors.push(label + ' setup auto-ran a comparison');
  await page.locator('.party-form').getByRole('button', { name: 'Compare friends', exact: true }).click();
  await page.locator('.friend-share-preview').waitFor({ state: 'visible', timeout: 15000 });
}

async function captureDownload(page, label) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Share card', exact: true }).click(),
  ]);
  if (download.suggestedFilename() !== 'ariadne-friends.svg') {
    errors.push(label + ' unexpected filename: ' + download.suggestedFilename());
  }
  const path = await download.path();
  if (!path) {
    errors.push(label + ' download did not produce a file');
    return '';
  }
  const svg = fs.readFileSync(path, 'utf8');
  if (!svg.includes('<svg') || !svg.includes('width="1200"') || !svg.includes('height="675"')) errors.push(label + ' downloaded card is not the expected SVG');
  if (!svg.includes('Matching usernames are public signals, not proof that accounts belong to the same person.')) errors.push(label + ' downloaded card lost the ownership caveat');
  return svg;
}

async function screenshotSvg(svg, path, label) {
  if (!svg) return;
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(label + ' svg pageerror: ' + error.message));
  await page.setContent(`<style>html,body{margin:0;width:1200px;height:675px;overflow:hidden}img{display:block;width:1200px;height:675px}</style><img alt="Friend footprint card" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
  await page.locator('img').screenshot({ path, type: 'jpeg', quality: 68 });
  await page.close();
}

const desktopNames = ['alice', 'bob'];
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await prepare(desktop, 'desktop');
await openComparison(desktop, desktopNames, 'desktop');
await desktop.locator('.friend-share-preview-section').scrollIntoViewIfNeeded();
await desktop.locator('.friend-share-preview-section').screenshot({ path: 'friend-card-desktop.jpg', type: 'jpeg', quality: 68 });
const desktopSvg = await captureDownload(desktop, 'desktop');
for (const name of desktopNames) {
  if (!desktopSvg.includes('@' + name)) errors.push('desktop SVG missing @' + name);
}
await screenshotSvg(desktopSvg, 'friend-card-svg-two.jpg', 'desktop');

const mobileNames = [
  'averylongusernameone',
  'averylongusernametwo',
  'averylongusernamethree',
  'averylongusernamefour',
  'averylongusernamefive',
  'averylongusernamesix',
];
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await prepare(mobile, 'mobile');
await openComparison(mobile, mobileNames, 'mobile');
await mobile.locator('.friend-share-preview-section').scrollIntoViewIfNeeded();
await mobile.screenshot({ path: 'friend-card-mobile.jpg', type: 'jpeg', quality: 68, fullPage: false });

const documentWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (documentWidth > 390) errors.push('mobile document horizontal overflow: ' + documentWidth);

const mobileSvg = await captureDownload(mobile, 'mobile');
for (const name of mobileNames) {
  const suffix = name.slice(-4);
  if (!mobileSvg.includes(suffix)) errors.push('six-person SVG missing distinguishing handle suffix for @' + name);
}
await screenshotSvg(mobileSvg, 'friend-card-svg-six.jpg', 'mobile');

for (const path of ['friend-card-desktop.jpg', 'friend-card-mobile.jpg', 'friend-card-svg-two.jpg', 'friend-card-svg-six.jpg']) {
  const base64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(base64);
  console.log('SCREENSHOT_END ' + path);
}

console.log('VISUAL_QA_ERRORS ' + JSON.stringify(errors));
await browser.close();

if (errors.length) {
  throw new Error('Friend card visual QA failed: ' + errors.join(' | '));
}
