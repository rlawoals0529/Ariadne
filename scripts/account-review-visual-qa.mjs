import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const errors = [];
const requestBodies = [];
const checkedAt = new Date().toISOString();

const fixtureResults = [
  ['github','GitHub','developer','FOUND','direct-api'],
  ['gitlab','GitLab','developer','POSSIBLE','catalog-rule'],
  ['reddit','Reddit','community','FOUND','direct-api'],
  ['twitch','Twitch','media','POSSIBLE','catalog-rule'],
  ['blocked','Blocked Example','other','BLOCKED','catalog-rule'],
  ['missing','Missing Example','developer','NOT_FOUND','direct-api'],
].map(([sourceId, sourceName, category, status, evidenceBasis], index) => ({
  sourceId,
  sourceName,
  category,
  status,
  evidenceBasis,
  profileUrl: 'https://example.com/' + sourceId + '/review_user',
  nsfw: false,
  confidence: status === 'FOUND' || status === 'NOT_FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : 'none',
  reason: 'Account-review visual fixture.',
  httpStatus: status === 'BLOCKED' ? 403 : status === 'NOT_FOUND' ? 404 : 200,
  checkedAt,
  durationMs: 100 + index * 11,
  signals: [],
}));

function summary(results) {
  const out = { FOUND:0, POSSIBLE:0, NOT_FOUND:0, UNKNOWN:0, BLOCKED:0, SKIPPED:0 };
  for (const result of results) out[result.status] += 1;
  return out;
}

function responseFor(query) {
  const results = fixtureResults.map((result) => ({
    ...result,
    profileUrl: result.profileUrl.replace('review_user', encodeURIComponent(query)),
  }));
  return {
    query,
    kind:'username',
    checkedAt,
    sourceCount:results.length,
    batchCount:results.length,
    includeNsfw:false,
    nextCursor:null,
    results,
    summary:summary(results),
  };
}

const sourceStats = {
  total: 6,
  standard: 6,
  nsfw: 0,
  direct: 3,
  heuristic: 3,
  disabled: 0,
  sourceAvailability: [],
};

async function prepare(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(label + ' console: ' + message.text());
  });
  page.on('pageerror', (error) => errors.push(label + ' pageerror: ' + error.message));
  await page.route('**/api/sources', (route) => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify(sourceStats),
  }));
  await page.route('**/api/search', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    requestBodies.push(body);
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify(responseFor(String(body.query || 'review_user'))),
    });
  });
}

let navigationId = 0;

async function openSoloScan(page, query) {
  navigationId += 1;
  await page.goto(url + '/?qa=' + navigationId + '#setup?mode=solo&u=' + encodeURIComponent(query), { waitUntil:'networkidle' });
  if (await page.locator('.profile-summary').count()) errors.push('shared setup auto-ran a scan');
  await page.getByRole('button', { name:'Search', exact:true }).click();
  await page.locator('.account-review').waitFor({ state:'visible', timeout:15000 });
}

function reviewRow(page, sourceName) {
  return page.locator('.review-row').filter({ has: page.locator('.review-source', { hasText:sourceName }) }).first();
}

const desktop = await browser.newPage({ viewport:{ width:1440, height:1100 }, deviceScaleFactor:1 });
await prepare(desktop, 'desktop');
await openSoloScan(desktop, 'review_user');

if (await desktop.locator('.review-row').count() !== 4) {
  errors.push('review board should include only four Found/Maybe candidates');
}
if (await reviewRow(desktop, 'Blocked Example').count()) errors.push('Blocked source appeared in account review');
if (await reviewRow(desktop, 'Missing Example').count()) errors.push('No-match source appeared in account review');

const github = reviewRow(desktop, 'GitHub');
await github.getByRole('button', { name:'Mine', exact:true }).click();
await github.getByRole('button', { name:'Clean up', exact:true }).click();

const gitlab = reviewRow(desktop, 'GitLab');
await gitlab.getByRole('button', { name:'Unsure', exact:true }).click();

const reddit = reviewRow(desktop, 'Reddit');
await reddit.getByRole('button', { name:'Not mine', exact:true }).click();

const progressText = (await desktop.locator('.review-progress').innerText()).replace(/\s+/g, ' ');
if (!progressText.includes('3/4') || !progressText.includes('1 to clean up')) {
  errors.push('review progress did not reflect explicit decisions: ' + progressText);
}

await desktop.getByRole('button', { name:/Clean up 1/ }).click();
if (await desktop.locator('.review-row').count() !== 1 || !(await desktop.locator('.review-row').innerText()).includes('GitHub')) {
  errors.push('Clean up filter did not isolate GitHub');
}
await desktop.getByRole('button', { name:/All 4/ }).click();

await desktop.locator('.account-review').scrollIntoViewIfNeeded();
await desktop.locator('.account-review').screenshot({ path:'review-desktop.jpg', type:'jpeg', quality:68 });

const storageSnapshot = await desktop.evaluate(() => Object.fromEntries(
  Object.keys(localStorage)
    .filter((key) => key.startsWith('ariadne:account-review:v1:'))
    .map((key) => [key, localStorage.getItem(key)])
));
const storageValues = Object.values(storageSnapshot).join(' ');
if (!storageValues.includes('"github"') || !storageValues.includes('"cleanup"')) {
  errors.push('review decisions were not persisted to localStorage');
}

await openSoloScan(desktop, 'review_user');
const githubReloaded = reviewRow(desktop, 'GitHub');
if (await githubReloaded.getByRole('button', { name:'Mine', exact:true }).getAttribute('aria-pressed') !== 'true') {
  errors.push('GitHub ownership did not persist after a new scan');
}
if (await githubReloaded.getByRole('button', { name:'Clean up', exact:true }).getAttribute('aria-pressed') !== 'true') {
  errors.push('GitHub cleanup action did not persist after a new scan');
}

await reviewRow(desktop, 'GitLab').getByRole('button', { name:'Reset', exact:true }).click();
await desktop.getByRole('button', { name:/Unreviewed 2/ }).click();
if (await desktop.locator('.review-row').count() !== 2) errors.push('Reset did not return GitLab to Unreviewed');
await desktop.getByRole('button', { name:/All 4/ }).click();

desktop.once('dialog', async (dialog) => dialog.accept());
await desktop.getByRole('button', { name:'Clear local review', exact:true }).click();
const clearedProgress = (await desktop.locator('.review-progress').innerText()).replace(/\s+/g, ' ');
if (!clearedProgress.includes('0/4')) errors.push('Clear local review did not reset progress');

const remainingReviewKeys = await desktop.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('ariadne:account-review:v1:')));
if (remainingReviewKeys.length) errors.push('Clear local review left review storage behind: ' + JSON.stringify(remainingReviewKeys));

const allowedSearchKeys = new Set(['query','kind','includeNsfw','cursor']);
for (const body of requestBodies) {
  const extra = Object.keys(body).filter((key) => !allowedSearchKeys.has(key));
  if (extra.length) errors.push('review data leaked into /api/search request keys: ' + extra.join(', '));
  const serialized = JSON.stringify(body);
  if (/ownership|cleanup|not-mine|unsure|review/i.test(serialized.replace(String(body.query || ''), ''))) {
    errors.push('review decision content leaked into /api/search request');
  }
}

const mobile = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
await prepare(mobile, 'mobile');
await openSoloScan(mobile, 'averylongusernameforreviewtesting');
await mobile.locator('.account-review').scrollIntoViewIfNeeded();

const mobileGithub = reviewRow(mobile, 'GitHub');
await mobileGithub.getByRole('button', { name:'Mine', exact:true }).click();
await mobileGithub.getByRole('button', { name:'Clean up', exact:true }).click();

const docWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (docWidth > 390) errors.push('mobile document horizontal overflow: ' + docWidth);

await mobile.screenshot({ path:'review-mobile.jpg', type:'jpeg', quality:68, fullPage:false });

for (const path of ['review-desktop.jpg','review-mobile.jpg']) {
  const base64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(base64);
  console.log('SCREENSHOT_END ' + path);
}

console.log('REVIEW_VISUAL_QA ' + JSON.stringify({
  errors,
  docWidth,
  requestCount: requestBodies.length,
  storageWasLocal: Object.keys(storageSnapshot).length > 0,
}));
await browser.close();

if (errors.length) throw new Error('Account review visual QA failed: ' + errors.join(' | '));
