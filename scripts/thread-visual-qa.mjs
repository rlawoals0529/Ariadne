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
].map(([sourceId,sourceName,category,status,evidenceBasis], index) => ({
  sourceId, sourceName, category, status, evidenceBasis,
  profileUrl: 'https://example.com/' + sourceId + '/thread_user',
  nsfw: false,
  confidence: status === 'FOUND' || status === 'NOT_FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : 'none',
  reason: status === 'FOUND' ? 'Canonical username matched.' : status === 'POSSIBLE' ? 'Representative public profile page.' : status === 'NOT_FOUND' ? 'Exact lookup returned no profile.' : 'Representative blocked response.',
  httpStatus: status === 'BLOCKED' ? 403 : status === 'NOT_FOUND' ? 404 : 200,
  checkedAt,
  durationMs: 120 + index * 17,
  signals: [{ kind: status === 'FOUND' ? 'identity' : status === 'NOT_FOUND' ? 'negative' : status === 'BLOCKED' ? 'block' : 'provenance', detail: 'Visual-QA fixture.' }],
}));

function summary(results) {
  const out = { FOUND:0, POSSIBLE:0, NOT_FOUND:0, UNKNOWN:0, BLOCKED:0, SKIPPED:0 };
  for (const r of results) out[r.status] += 1;
  return out;
}

function responseFor(query) {
  const results = fixtureResults.map(r => ({ ...r, profileUrl: r.profileUrl.replace('thread_user', query) }));
  return {
    query, kind:'username', checkedAt, sourceCount:results.length, batchCount:results.length,
    includeNsfw:false, nextCursor:null, results, summary:summary(results),
  };
}

const sourceStats = {
  total: 14, standard: 14, nsfw: 0, direct: 7, heuristic: 7, disabled: 0,
  sourceAvailability: [],
};

async function prepare(page, label) {
  page.on('console', msg => { if (msg.type() === 'error') errors.push(label + ' console: ' + msg.text()); });
  page.on('pageerror', error => errors.push(label + ' pageerror: ' + error.message));
  await page.route('**/api/sources', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(sourceStats) }));
  await page.route('**/api/search', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(responseFor(String(body.query || 'thread_user'))) });
  });
}

const desktop = await browser.newPage({ viewport:{ width:1440, height:1100 }, deviceScaleFactor:1 });
await prepare(desktop, 'desktop');
await desktop.goto(url + '/#setup?mode=solo&u=Thread_User', { waitUntil:'networkidle' });
if ((await desktop.locator('#username').inputValue()) !== 'Thread_User') errors.push('solo setup did not prefill username');
if (await desktop.evaluate(() => location.hash)) errors.push('solo setup fragment was not cleared after load');
if (await desktop.locator('.profile-summary').count()) errors.push('shared solo setup auto-ran a scan');

await desktop.getByRole('button', { name:'Search', exact:true }).click();
await desktop.locator('.thread-map').waitFor({ state:'visible', timeout:15000 });
await desktop.screenshot({ path:'thread-desktop.jpg', type:'jpeg', quality:60, fullPage:true });

const developerNode = desktop.locator('.thread-node').filter({ hasText:'Developer' }).first();
await developerNode.click();
await desktop.waitForTimeout(300);
const selectedCategory = (await desktop.locator('.category-menu > summary strong').textContent())?.trim().toLowerCase();
if (selectedCategory !== 'developer') errors.push('Thread Map node did not set developer category filter');
await desktop.screenshot({ path:'thread-desktop-filtered.jpg', type:'jpeg', quality:60, fullPage:true });

const mobile = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
await prepare(mobile, 'mobile');
await mobile.goto(url + '/#setup?mode=solo&u=averylongusernameaverylongusernameaverylongusername', { waitUntil:'networkidle' });
if (await mobile.evaluate(() => location.hash)) errors.push('mobile setup fragment was not cleared after load');
await mobile.getByRole('button', { name:'Search', exact:true }).click();
await mobile.locator('.thread-map').waitFor({ state:'visible', timeout:15000 });
await mobile.locator('.thread-map').scrollIntoViewIfNeeded();
await mobile.screenshot({ path:'thread-mobile.jpg', type:'jpeg', quality:62, fullPage:false });

const docWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (docWidth > 390) {
  errors.push('mobile document horizontal overflow: ' + docWidth);
  const offenders = await mobile.evaluate(() => [...document.querySelectorAll('*')]
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return { tag: el.tagName, cls: el.className || '', text: (el.textContent || '').trim().slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
    })
    .filter((item) => item.left < -1 || item.right > 391 || item.width > 391)
    .slice(0, 40));
  console.log('MOBILE_OVERFLOW_OFFENDERS ' + JSON.stringify(offenders));
}

const party = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
await prepare(party, 'party');
await party.goto(url + '/#setup?mode=party&u=alice&u=bob&u=charlie', { waitUntil:'networkidle' });
const partyValues = await party.locator('.party-input-row input').evaluateAll(els => els.map(el => el.value));
if (JSON.stringify(partyValues) !== JSON.stringify(['alice','bob','charlie'])) errors.push('party setup did not prefill all usernames: ' + JSON.stringify(partyValues));
if (await party.evaluate(() => location.hash)) errors.push('party setup fragment was not cleared after load');
if (await party.locator('.party-report').count()) errors.push('shared party setup auto-ran comparison');
await party.screenshot({ path:'share-party-mobile.jpg', type:'jpeg', quality:62, fullPage:false });

for (const path of ['thread-desktop.jpg','thread-desktop-filtered.jpg','thread-mobile.jpg','share-party-mobile.jpg']) {
  const b64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(b64);
  console.log('SCREENSHOT_END ' + path);
}
console.log('VISUAL_QA_ERRORS ' + JSON.stringify(errors));
await browser.close();
