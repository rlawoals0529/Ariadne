import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const errors = [];
const checkedAt = new Date().toISOString();

const fixtureResults = [
  ['github','GitHub','developer','FOUND','direct-api','https://github.com/cleanup_user'],
  ['reddit','Reddit','community','POSSIBLE','catalog-rule','https://reddit.com/u/cleanup_user'],
  ['twitch','Twitch','social','FOUND','direct-api','https://twitch.tv/cleanup_user'],
  ['unknown','Unknown Social','social','POSSIBLE','catalog-rule','https://example.com/cleanup_user'],
].map(([sourceId, sourceName, category, status, evidenceBasis, profileUrl], index) => ({
  sourceId,
  sourceName,
  category,
  status,
  evidenceBasis,
  profileUrl,
  nsfw: false,
  confidence: status === 'FOUND' ? 'high' : 'medium',
  reason: 'Cleanup export visual fixture.',
  httpStatus: 200,
  checkedAt,
  durationMs: 90 + index * 12,
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
    profileUrl: result.profileUrl.replace('cleanup_user', encodeURIComponent(query)),
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
  total: 4,
  standard: 4,
  nsfw: 0,
  direct: 2,
  heuristic: 2,
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
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify(responseFor(String(body.query || 'cleanup_user'))),
    });
  });
}

async function openSolo(page, query) {
  await page.goto(url + '/?qa=' + encodeURIComponent(query) + '#setup?mode=solo&u=' + encodeURIComponent(query), { waitUntil:'networkidle' });
  await page.getByRole('button', { name:'Search', exact:true }).click();
  await page.locator('.account-review').waitFor({ state:'visible', timeout:15000 });
}

function row(page, sourceName) {
  return page.locator('.review-row').filter({ has: page.locator('.review-source', { hasText:sourceName }) }).first();
}

async function mark(page, sourceName, action) {
  const target = row(page, sourceName);
  await target.getByRole('button', { name:'Mine', exact:true }).click();
  await target.getByRole('button', { name:action, exact:true }).click();
}

const desktop = await browser.newPage({ viewport:{ width:1440, height:1050 }, deviceScaleFactor:1 });
await prepare(desktop, 'desktop');
await openSolo(desktop, 'Cleanup_User');

if (await desktop.getByRole('button', { name:'Export cleanup list', exact:true }).count()) {
  errors.push('export button appeared before any cleanup or done decisions');
}

await mark(desktop, 'GitHub', 'Clean up');
await mark(desktop, 'Reddit', 'Done');
await mark(desktop, 'Twitch', 'Keep');

const unknown = row(desktop, 'Unknown Social');
await unknown.getByRole('button', { name:'Unsure', exact:true }).click();

const exportButton = desktop.getByRole('button', { name:'Export cleanup list', exact:true });
if (await exportButton.count() !== 1) errors.push('export button missing after cleanup decisions');

const [download] = await Promise.all([
  desktop.waitForEvent('download'),
  exportButton.click(),
]);

if (download.suggestedFilename() !== 'ariadne-cleanup-cleanup_user.md') {
  errors.push('unexpected cleanup filename: ' + download.suggestedFilename());
}

const path = await download.path();
if (!path) {
  errors.push('cleanup export did not create a file');
} else {
  const markdown = fs.readFileSync(path, 'utf8');

  if (!markdown.includes('- [ ] GitHub — Clean up')) errors.push('GitHub cleanup item missing');
  if (!markdown.includes('- [x] Reddit — Done')) errors.push('Reddit done item missing');
  if (markdown.includes('Twitch')) errors.push('Keep item leaked into cleanup export');
  if (markdown.includes('Unknown Social')) errors.push('Unsure item leaked into cleanup export');
  if (!markdown.includes('Evidence: Found')) errors.push('Found evidence label missing');
  if (!markdown.includes('Evidence: Maybe')) errors.push('Maybe evidence label missing');
  if (!markdown.includes('docs.github.com')) errors.push('GitHub official resource missing');
  if (!markdown.includes('support.reddithelp.com')) errors.push('Reddit official resource missing');
  if (!markdown.includes('Ariadne does not infer ownership')) errors.push('ownership caveat missing');
}

await desktop.locator('.account-review').scrollIntoViewIfNeeded();
await desktop.locator('.account-review').screenshot({ path:'cleanup-export-desktop.jpg', type:'jpeg', quality:70 });

const mobile = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
await prepare(mobile, 'mobile');
await openSolo(mobile, 'cleanupmobile');
await mark(mobile, 'GitHub', 'Clean up');

const docWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (docWidth > 390) errors.push('mobile document horizontal overflow: ' + docWidth);

const actionRect = await mobile.locator('.review-toolbar-actions').evaluate((element) => ({
  width: Math.round(element.getBoundingClientRect().width),
  scrollWidth: element.scrollWidth,
  clientWidth: element.clientWidth,
}));
if (actionRect.scrollWidth > actionRect.clientWidth) {
  errors.push('mobile review actions overflow: ' + JSON.stringify(actionRect));
}

await mobile.locator('.account-review').scrollIntoViewIfNeeded();
await mobile.screenshot({ path:'cleanup-export-mobile.jpg', type:'jpeg', quality:70, fullPage:false });

for (const p of ['cleanup-export-desktop.jpg','cleanup-export-mobile.jpg']) {
  const base64 = fs.readFileSync(p).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + p);
  console.log(base64);
  console.log('SCREENSHOT_END ' + p);
}

console.log('CLEANUP_EXPORT_QA ' + JSON.stringify({ errors, docWidth, actionRect }));
await browser.close();

if (errors.length) throw new Error('Cleanup export visual QA failed: ' + errors.join(' | '));
