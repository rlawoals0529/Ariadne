import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const errors = [];
const checkedAt = new Date().toISOString();

const catalog = {
  alice: [
    ['github','GitHub','developer','FOUND','direct-api'],
    ['steam','Steam','gaming','FOUND','direct-api'],
    ['reddit','Reddit','community','POSSIBLE','catalog-rule'],
    ['letterboxd','Letterboxd','media','POSSIBLE','catalog-rule'],
    ['codepen','CodePen','developer','FOUND','catalog-rule'],
    ['mastodon','Mastodon','social','NOT_FOUND','catalog-rule'],
  ],
  bob: [
    ['github','GitHub','developer','FOUND','direct-api'],
    ['steam','Steam','gaming','POSSIBLE','catalog-rule'],
    ['reddit','Reddit','community','POSSIBLE','catalog-rule'],
    ['twitch','Twitch','media','FOUND','catalog-rule'],
    ['spotify','Spotify','media','FOUND','catalog-rule'],
    ['codepen','CodePen','developer','NOT_FOUND','catalog-rule'],
  ],
  charlie: [
    ['github','GitHub','developer','POSSIBLE','catalog-rule'],
    ['twitch','Twitch','media','FOUND','catalog-rule'],
    ['letterboxd','Letterboxd','media','FOUND','catalog-rule'],
    ['discord','Discord','community','POSSIBLE','catalog-rule'],
    ['itch','itch.io','gaming','FOUND','catalog-rule'],
    ['steam','Steam','gaming','NOT_FOUND','direct-api'],
  ],
};

function toResult([sourceId,sourceName,category,status,evidenceBasis], query, index) {
  return {
    sourceId, sourceName, category, status, evidenceBasis,
    profileUrl: 'https://example.com/' + sourceId + '/' + query,
    nsfw: false,
    confidence: status === 'FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : 'high',
    reason: status === 'FOUND' ? 'Representative exact or public profile signal.' : status === 'POSSIBLE' ? 'Representative broad public-page signal.' : 'Representative no-match response.',
    httpStatus: status === 'NOT_FOUND' ? 404 : 200,
    checkedAt,
    durationMs: 140 + index * 23,
    signals: [{ kind: status === 'FOUND' ? 'identity' : status === 'POSSIBLE' ? 'provenance' : 'negative', detail: 'Friend Mode visual-QA fixture.' }],
  };
}
function summarize(results) {
  const out = { FOUND:0, POSSIBLE:0, NOT_FOUND:0, UNKNOWN:0, BLOCKED:0, SKIPPED:0 };
  for (const r of results) out[r.status] += 1;
  return out;
}
function responseFor(query) {
  const items = (catalog[query] || catalog.alice).map((item,index)=>toResult(item,query,index));
  return { query, kind:'username', checkedAt, sourceCount:items.length, batchCount:items.length, includeNsfw:false, nextCursor:null, results:items, summary:summarize(items) };
}
const sourceStats = {
  total: 24, standard: 24, nsfw: 4, direct: 7, heuristic: 17, disabled: 0,
  sourceAvailability: [
    { id:'github', name:'GitHub', state:'exact', label:'Exact', detail:'Provider can return the requested username directly.' },
    { id:'catalog', name:'Public profile catalog', state:'fallback', label:'Broad check', detail:'Public pages are checked without claiming identity.' },
  ],
};

async function prepare(page, label) {
  page.on('console', msg => { if (msg.type() === 'error') errors.push(label + ' console: ' + msg.text()); });
  page.on('pageerror', error => errors.push(label + ' pageerror: ' + error.message));
  await page.route('**/api/sources', async route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(sourceStats) }));
  await page.route('**/api/search', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(responseFor(String(body.query || 'alice').toLowerCase())) });
  });
}

async function compare(page) {
  await page.goto(url, { waitUntil:'networkidle', timeout:60000 });
  await page.getByRole('button', { name:'Compare friends', exact:true }).first().click();
  const inputs = page.locator('.party-input-row input');
  await inputs.nth(0).fill('alice');
  await inputs.nth(1).fill('bob');
  await page.getByRole('button', { name:/Add friend/i }).click();
  await page.locator('.party-input-row input').nth(2).fill('charlie');
  await page.getByRole('button', { name:'Compare friends', exact:true }).last().click();
  await page.locator('.friend-report-hero').waitFor({ state:'visible', timeout:15000 });
  await page.waitForTimeout(300);
}

const desktop = await browser.newPage({ viewport:{ width:1440, height:1100 }, deviceScaleFactor:1 });
await prepare(desktop,'desktop');
await compare(desktop);
await desktop.screenshot({ path:'friend-desktop.jpg', type:'jpeg', quality:60, fullPage:true });
await desktop.locator('.friend-comparison-details > summary').click();
await desktop.screenshot({ path:'friend-desktop-expanded.jpg', type:'jpeg', quality:60, fullPage:true });

const mobile = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
await prepare(mobile,'mobile');
await compare(mobile);
await mobile.locator('.friend-report-hero').scrollIntoViewIfNeeded();
await mobile.screenshot({ path:'friend-mobile.jpg', type:'jpeg', quality:62, fullPage:true });
await mobile.locator('.friend-comparison-details > summary').click();
await mobile.locator('.friend-comparison-details').scrollIntoViewIfNeeded();
await mobile.screenshot({ path:'friend-mobile-details.jpg', type:'jpeg', quality:62, fullPage:false });

await mobile.locator('.friend-report-main h2').evaluate(el => { el.textContent = '@averylongusernameaverylongusername × @anotherverylongusernameanotherverylongusername × @thirdlongusername'; });
await mobile.locator('.friend-report-hero').scrollIntoViewIfNeeded();
await mobile.locator('.friend-report-hero').screenshot({ path:'friend-mobile-long-names.jpg', type:'jpeg', quality:64 });

for (const selector of ['.party-report','.friend-report-hero','.friend-games','.party-scoreboard','.shared-paths','.friend-comparison-details']) {
  const box = await mobile.locator(selector).boundingBox();
  if (box && (box.x < -1 || box.x + box.width > 391)) errors.push('overflow ' + selector + ': x=' + box.x + ' width=' + box.width);
}
const docWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (docWidth > 390) errors.push('document horizontal overflow: ' + docWidth);

for (const path of ['friend-desktop.jpg','friend-desktop-expanded.jpg','friend-mobile.jpg','friend-mobile-details.jpg','friend-mobile-long-names.jpg']) {
  const b64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(b64);
  console.log('SCREENSHOT_END ' + path);
}
console.log('VISUAL_QA_ERRORS ' + JSON.stringify(errors));
await browser.close();
