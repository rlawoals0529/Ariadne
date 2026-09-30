import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'https://ariadne.rlawoals0529.workers.dev';
const browser = await chromium.launch({ headless: true });
const errors = [];
const checkedAt = new Date().toISOString();

const fixtureResults = [
  ['github','GitHub','developer','FOUND','direct-api',200,184],
  ['steam','Steam','gaming','FOUND','direct-api',200,221],
  ['reddit','Reddit','community','FOUND','catalog-rule',200,312],
  ['twitch','Twitch','media','FOUND','catalog-rule',200,246],
  ['gitlab','GitLab','developer','POSSIBLE','catalog-rule',200,277],
  ['itch','itch.io','gaming','POSSIBLE','catalog-rule',200,331],
  ['behance','Behance','creative','POSSIBLE','catalog-rule',200,290],
  ['mastodon','Mastodon','social','UNKNOWN','catalog-rule',200,404],
  ['youtube','YouTube','media','BLOCKED','direct-api',429,510],
  ['bluesky','Bluesky','social','BLOCKED','catalog-rule',403,381],
  ['codeberg','Codeberg','developer','NOT_FOUND','direct-api',404,166],
  ['devto','DEV Community','developer','NOT_FOUND','direct-api',404,194],
  ['soundcloud','SoundCloud','media','NOT_FOUND','catalog-rule',404,240],
  ['pinterest','Pinterest','social','NOT_FOUND','catalog-rule',404,264],
  ['letterboxd','Letterboxd','media','NOT_FOUND','catalog-rule',404,301],
  ['kaggle','Kaggle','developer','NOT_FOUND','catalog-rule',404,225],
  ['chess','Chess.com','gaming','NOT_FOUND','catalog-rule',404,316],
  ['medium','Medium','creative','NOT_FOUND','catalog-rule',404,288],
  ['tumblr','Tumblr','social','NOT_FOUND','catalog-rule',404,271],
  ['rule','Example Format-Limited Site','other','SKIPPED','catalog-rule',null,0],
].map(([sourceId,sourceName,category,status,evidenceBasis,httpStatus,durationMs]) => ({
  sourceId, sourceName, category, status, evidenceBasis, httpStatus, durationMs,
  profileUrl: 'https://example.com/' + sourceId + '/octocat',
  nsfw: false,
  confidence: status === 'FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : status === 'NOT_FOUND' ? 'high' : status === 'SKIPPED' ? 'none' : 'low',
  reason: status === 'FOUND' ? 'Exact username returned by provider.' : status === 'POSSIBLE' ? 'Public profile page responded, but identity was not returned directly.' : status === 'NOT_FOUND' ? 'Exact or catalog rule returned no matching profile.' : status === 'BLOCKED' ? 'Provider limited or blocked this request.' : status === 'UNKNOWN' ? 'Response was not strong enough to decide.' : 'Username format is not supported by this source.',
  checkedAt,
  signals: [{ kind: evidenceBasis === 'direct-api' ? 'identity' : status === 'BLOCKED' ? 'block' : status === 'NOT_FOUND' ? 'negative' : 'provenance', detail: 'Representative browser-QA fixture signal.' }],
}));

function summary(results) {
  const out = { FOUND:0, POSSIBLE:0, NOT_FOUND:0, UNKNOWN:0, BLOCKED:0, SKIPPED:0 };
  for (const r of results) out[r.status] += 1;
  return out;
}

const fixtureResponse = {
  query: 'octocat', kind: 'username', checkedAt, sourceCount: 24, batchCount: fixtureResults.length,
  includeNsfw: false, nextCursor: null, results: fixtureResults, summary: summary(fixtureResults),
};
const sourceStats = {
  total: 28, standard: 24, nsfw: 4, direct: 7, heuristic: 17, disabled: 4,
  sourceAvailability: [
    { id:'github', name:'GitHub', state:'exact', label:'Exact', detail:'Provider can return the requested username directly.' },
    { id:'steam', name:'Steam', state:'exact', label:'Exact', detail:'Provider can resolve the username directly.' },
    { id:'youtube', name:'YouTube', state:'unavailable', label:'Unavailable', detail:'Credential-backed exact check is not available in this fixture.' },
    { id:'catalog', name:'Public profile catalog', state:'fallback', label:'Broad check', detail:'Public pages are checked without claiming identity.' },
  ],
};

async function prepare(page, label) {
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(label + ' console: ' + msg.text()); });
  page.on('pageerror', (error) => errors.push(label + ' pageerror: ' + error.message));
  await page.route('**/api/sources', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sourceStats) }));
  await page.route('**/api/search', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtureResponse) }));
}

async function scan(page) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('#username').fill('octocat');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.profile-summary').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await prepare(desktop, 'desktop');
await scan(desktop);
await desktop.screenshot({ path: 'desktop-result.jpg', type: 'jpeg', quality: 58, fullPage: true });
await desktop.locator('.scan-insights > summary').click();
await desktop.locator('.scan-support-stack .source-availability > summary').click();
await desktop.screenshot({ path: 'desktop-expanded.jpg', type: 'jpeg', quality: 58, fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await prepare(mobile, 'mobile');
await scan(mobile);
await mobile.locator('#evidence-explorer').scrollIntoViewIfNeeded();
await mobile.screenshot({ path: 'mobile-evidence.jpg', type: 'jpeg', quality: 58, fullPage: true });
await mobile.locator('.category-menu > summary').click();
await mobile.screenshot({ path: 'mobile-category.jpg', type: 'jpeg', quality: 58, fullPage: false });

const longText = '@' + 'averylongusername'.repeat(4);
await mobile.locator('.profile-identity h3').evaluate((el, text) => { el.textContent = text; }, longText);
await mobile.locator('.profile-summary').scrollIntoViewIfNeeded();
await mobile.screenshot({ path: 'mobile-long-username.jpg', type: 'jpeg', quality: 58, fullPage: false });

for (const selector of ['.profile-summary', '.scan-support-stack', '#evidence-explorer', '.results-list']) {
  const box = await mobile.locator(selector).boundingBox();
  if (box && (box.x < -1 || box.x + box.width > 391)) errors.push('overflow ' + selector + ': x=' + box.x + ' width=' + box.width);
}
const docWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (docWidth > 390) errors.push('document horizontal overflow: ' + docWidth);

for (const path of ['desktop-result.jpg','desktop-expanded.jpg','mobile-evidence.jpg','mobile-category.jpg','mobile-long-username.jpg']) {
  const b64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(b64);
  console.log('SCREENSHOT_END ' + path);
}
console.log('VISUAL_QA_ERRORS ' + JSON.stringify(errors));
await browser.close();
