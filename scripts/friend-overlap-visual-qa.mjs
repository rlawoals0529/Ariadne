import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const errors = [];
const checkedAt = new Date().toISOString();

const sourceDefinitions = [
  { sourceId:'github', sourceName:'GitHub', category:'developer', statuses:['FOUND','FOUND','FOUND','FOUND','FOUND','FOUND'], basis:'direct-api' },
  { sourceId:'gitlab', sourceName:'GitLab', category:'developer', statuses:['POSSIBLE','FOUND','POSSIBLE','FOUND','POSSIBLE','FOUND'], basis:'catalog-rule' },
  { sourceId:'steam', sourceName:'Steam', category:'gaming', statuses:['FOUND',null,'FOUND',null,'FOUND',null], basis:'direct-api' },
  { sourceId:'twitch', sourceName:'Twitch', category:'media', statuses:[null,'POSSIBLE','POSSIBLE','POSSIBLE',null,'POSSIBLE'], basis:'catalog-rule' },
  { sourceId:'reddit', sourceName:'Reddit', category:'community', statuses:['FOUND','FOUND',null,null,'FOUND','FOUND'], basis:'direct-api' },
  { sourceId:'behance', sourceName:'Behance', category:'creative', statuses:['POSSIBLE',null,'POSSIBLE',null,'POSSIBLE',null], basis:'catalog-rule' },
  { sourceId:'mastodon', sourceName:'Mastodon', category:'social', statuses:['POSSIBLE','POSSIBLE',null,'POSSIBLE',null,'POSSIBLE'], basis:'catalog-rule' },
  { sourceId:'blocked', sourceName:'Blocked Example', category:'other', statuses:['BLOCKED','BLOCKED','BLOCKED','BLOCKED','BLOCKED','BLOCKED'], basis:'catalog-rule' },
  { sourceId:'missing', sourceName:'Missing Example', category:'developer', statuses:['NOT_FOUND','NOT_FOUND','NOT_FOUND','NOT_FOUND','NOT_FOUND','NOT_FOUND'], basis:'direct-api' },
];

const knownNames = [
  'alice',
  'bob',
  'averylongusernameone',
  'averylongusernametwo',
  'averylongusernamethree',
  'averylongusernamefour',
  'averylongusernamefive',
  'averylongusernamesix',
];

function indexFor(query) {
  if (query === 'alice') return 0;
  if (query === 'bob') return 1;
  const mobileIndex = knownNames.slice(2).indexOf(query);
  return mobileIndex >= 0 ? mobileIndex : 0;
}

function resultFor(source, query, personIndex) {
  const status = source.statuses[personIndex] ?? null;
  const finalStatus = status ?? 'UNKNOWN';
  return {
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    category: source.category,
    status: finalStatus,
    evidenceBasis: source.basis,
    profileUrl: 'https://example.com/' + source.sourceId + '/' + encodeURIComponent(query),
    nsfw: false,
    confidence: finalStatus === 'FOUND' || finalStatus === 'NOT_FOUND' ? 'high' : finalStatus === 'POSSIBLE' ? 'medium' : 'none',
    reason: finalStatus === 'FOUND' ? 'Canonical username matched.' : finalStatus === 'POSSIBLE' ? 'Representative public profile page.' : finalStatus === 'NOT_FOUND' ? 'Exact lookup returned no profile.' : finalStatus === 'BLOCKED' ? 'Representative blocked response.' : 'No usable signal for this fixture.',
    httpStatus: finalStatus === 'BLOCKED' ? 403 : finalStatus === 'NOT_FOUND' ? 404 : 200,
    checkedAt,
    durationMs: 80 + personIndex * 9,
    signals: [],
  };
}

function responseFor(query) {
  const personIndex = indexFor(query);
  const results = sourceDefinitions.map((source) => resultFor(source, query, personIndex));
  const summary = { FOUND:0, POSSIBLE:0, NOT_FOUND:0, UNKNOWN:0, BLOCKED:0, SKIPPED:0 };
  for (const result of results) summary[result.status] += 1;
  return {
    query,
    kind:'username',
    checkedAt,
    sourceCount:results.length,
    batchCount:results.length,
    includeNsfw:false,
    nextCursor:null,
    results,
    summary,
  };
}

const sourceStats = {
  total: sourceDefinitions.length,
  standard: sourceDefinitions.length,
  nsfw: 0,
  direct: 3,
  heuristic: sourceDefinitions.length - 3,
  disabled: 0,
  sourceAvailability: [],
};

async function prepare(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(label + ' console: ' + message.text());
  });
  page.on('pageerror', (error) => errors.push(label + ' pageerror: ' + error.message));
  await page.route('**/api/sources', (route) => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(sourceStats) }));
  await page.route('**/api/search', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(responseFor(String(body.query || 'alice'))) });
  });
}

async function openComparison(page, names, label) {
  const fragment = '#setup?mode=party&' + names.map((name) => 'u=' + encodeURIComponent(name)).join('&');
  await page.goto(url + '/' + fragment, { waitUntil:'networkidle' });
  if (await page.locator('.party-report').count()) errors.push(label + ' setup auto-ran comparison');
  await page.locator('.party-form').getByRole('button', { name:'Compare friends', exact:true }).click();
  await page.locator('.overlap-map').waitFor({ state:'visible', timeout:15000 });
}

function rowFor(page, sourceName) {
  return page.locator('.overlap-source-row').filter({ has: page.locator('.overlap-source-name', { hasText: sourceName }) }).first();
}

const desktop = await browser.newPage({ viewport:{ width:1440, height:1100 }, deviceScaleFactor:1 });
await prepare(desktop, 'desktop');
await openComparison(desktop, ['alice','bob'], 'desktop');

const github = rowFor(desktop, 'GitHub');
const githubCells = await github.locator('.overlap-cell > span').allTextContents();
if (JSON.stringify(githubCells) !== JSON.stringify(['F','F'])) errors.push('desktop GitHub row was not Found/Found: ' + JSON.stringify(githubCells));

const gitlab = rowFor(desktop, 'GitLab');
const gitlabCells = await gitlab.locator('.overlap-cell > span').allTextContents();
if (JSON.stringify(gitlabCells) !== JSON.stringify(['M','F'])) errors.push('desktop GitLab row did not preserve Maybe/Found: ' + JSON.stringify(gitlabCells));

if (await rowFor(desktop, 'Blocked Example').count()) errors.push('Blocked source leaked into overlap map');
if (await rowFor(desktop, 'Missing Example').count()) errors.push('No-match source leaked into overlap map');

await desktop.locator('.overlap-map').scrollIntoViewIfNeeded();
await desktop.locator('.overlap-map').screenshot({ path:'overlap-desktop.jpg', type:'jpeg', quality:68 });

const mobileNames = knownNames.slice(2);
const mobile = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
await prepare(mobile, 'mobile');
await openComparison(mobile, mobileNames, 'mobile');
await mobile.locator('.overlap-map').scrollIntoViewIfNeeded();

const docWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (docWidth > 390) errors.push('mobile document horizontal overflow: ' + docWidth);

const scrollMetrics = await mobile.locator('.overlap-scroll').evaluate((element) => ({
  clientWidth: element.clientWidth,
  scrollWidth: element.scrollWidth,
}));
if (scrollMetrics.scrollWidth <= scrollMetrics.clientWidth) errors.push('six-person overlap map did not create its intended internal scroller');

await mobile.screenshot({ path:'overlap-mobile-start.jpg', type:'jpeg', quality:68, fullPage:false });
await mobile.locator('.overlap-scroll').evaluate((element) => { element.scrollLeft = element.scrollWidth; });
await mobile.waitForTimeout(150);
await mobile.screenshot({ path:'overlap-mobile-end.jpg', type:'jpeg', quality:68, fullPage:false });

const mobileGithubCells = await rowFor(mobile, 'GitHub').locator('.overlap-cell > span').allTextContents();
if (mobileGithubCells.length !== 6 || mobileGithubCells.some((value) => value !== 'F')) {
  errors.push('six-person GitHub row did not show six Found markers: ' + JSON.stringify(mobileGithubCells));
}

for (const path of ['overlap-desktop.jpg','overlap-mobile-start.jpg','overlap-mobile-end.jpg']) {
  const base64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(base64);
  console.log('SCREENSHOT_END ' + path);
}

console.log('OVERLAP_VISUAL_QA ' + JSON.stringify({ errors, docWidth, scrollMetrics }));
await browser.close();

if (errors.length) throw new Error('Overlap visual QA failed: ' + errors.join(' | '));
