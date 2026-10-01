import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const errors = [];
const checkedAt = new Date().toISOString();

const fixtureResults = [
  ['github','GitHub','developer','FOUND','direct-api'],
  ['gitlab','GitLab','developer','POSSIBLE','catalog-rule'],
  ['reddit','Reddit','community','FOUND','direct-api'],
  ['tumblr','tumblr','social','POSSIBLE','catalog-rule'],
  ['ultimate-guitar','Ultimate-Guitar','media','POSSIBLE','catalog-rule'],
  ['velomania','Velomania','community','POSSIBLE','catalog-rule'],
  ['blocked','Blocked Example','other','BLOCKED','catalog-rule'],
  ['missing','Missing Example','developer','NOT_FOUND','direct-api'],
].map(([sourceId, sourceName, category, status, evidenceBasis], index) => ({
  sourceId,
  sourceName,
  category,
  status,
  evidenceBasis,
  profileUrl: 'https://example.com/' + sourceId + '/fixture_user',
  nsfw: false,
  confidence: status === 'FOUND' || status === 'NOT_FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : 'none',
  reason: 'Alignment QA fixture.',
  httpStatus: status === 'BLOCKED' ? 403 : status === 'NOT_FOUND' ? 404 : 200,
  checkedAt,
  durationMs: 90 + index * 10,
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
    profileUrl: result.profileUrl.replace('fixture_user', encodeURIComponent(query)),
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
  total: 8,
  standard: 8,
  nsfw: 0,
  direct: 3,
  heuristic: 5,
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
      body:JSON.stringify(responseFor(String(body.query || 'fixture_user'))),
    });
  });
}

async function openSolo(page, query) {
  await page.goto(url + '/?qa=' + encodeURIComponent(query) + '#setup?mode=solo&u=' + encodeURIComponent(query), { waitUntil:'networkidle' });
  await page.getByRole('button', { name:'Search', exact:true }).click();
  await page.locator('.account-review').waitFor({ state:'visible', timeout:15000 });
}

function reviewRow(page, sourceName) {
  return page.locator('.review-row').filter({ has: page.locator('.review-source', { hasText:sourceName }) }).first();
}

const desktop = await browser.newPage({ viewport:{ width:1440, height:1000 }, deviceScaleFactor:1 });
await prepare(desktop, 'desktop');
await openSolo(desktop, 'layoutcheck');

const github = reviewRow(desktop, 'GitHub');
await github.getByRole('button', { name:'Mine', exact:true }).click();
await github.getByRole('button', { name:'Clean up', exact:true }).click();

await desktop.locator('.account-review').scrollIntoViewIfNeeded();
await desktop.locator('.account-review').screenshot({ path:'review-align-desktop.jpg', type:'jpeg', quality:70 });

const desktopRows = await desktop.locator('.review-row').evaluateAll((rows) => rows.slice(0, 6).map((row) => {
  const rect = row.getBoundingClientRect();
  const source = row.querySelector('.review-source')?.getBoundingClientRect();
  const choices = [...row.querySelectorAll('.review-choice')].map((el) => el.getBoundingClientRect());
  return {
    rowHeight: Math.round(rect.height),
    sourceTop: source ? Math.round(source.top - rect.top) : null,
    choiceTops: choices.map((r) => Math.round(r.top - rect.top)),
    choiceHeights: choices.map((r) => Math.round(r.height)),
  };
}));

if (desktopRows.some((row) => row.choiceTops.some((top) => top !== row.sourceTop))) {
  errors.push('desktop columns do not share the same top edge: ' + JSON.stringify(desktopRows));
}
if (desktopRows.some((row) => row.rowHeight > 125)) {
  errors.push('desktop review row still too tall: ' + JSON.stringify(desktopRows));
}

const tablet = await browser.newPage({ viewport:{ width:980, height:1000 }, deviceScaleFactor:1 });
await prepare(tablet, 'tablet');
await openSolo(tablet, 'layoutchecktablet');
await tablet.locator('.account-review').scrollIntoViewIfNeeded();
await tablet.locator('.account-review').screenshot({ path:'review-align-tablet.jpg', type:'jpeg', quality:70 });

const mobile = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
await prepare(mobile, 'mobile');
await openSolo(mobile, 'averylongusernameforalignment');

const mobileGithub = reviewRow(mobile, 'GitHub');
await mobileGithub.getByRole('button', { name:'Mine', exact:true }).click();
await mobileGithub.getByRole('button', { name:'Clean up', exact:true }).click();

await mobile.locator('.account-review').scrollIntoViewIfNeeded();
const docWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (docWidth > 390) errors.push('mobile document horizontal overflow: ' + docWidth);

const disabledActionButtons = await reviewRow(mobile, 'GitLab').locator('.review-action button').evaluateAll((buttons) =>
  buttons.map((button) => ({ disabled: button.disabled, text: button.textContent?.trim() }))
);
if (disabledActionButtons.some((button) => !button.disabled)) {
  errors.push('unreviewed action buttons were not disabled: ' + JSON.stringify(disabledActionButtons));
}

await mobile.screenshot({ path:'review-align-mobile.jpg', type:'jpeg', quality:70, fullPage:false });

for (const path of ['review-align-desktop.jpg','review-align-tablet.jpg','review-align-mobile.jpg']) {
  const base64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(base64);
  console.log('SCREENSHOT_END ' + path);
}

console.log('ALIGN_VISUAL_QA ' + JSON.stringify({ errors, docWidth, desktopRows }));
await browser.close();

if (errors.length) throw new Error('Account review alignment QA failed: ' + errors.join(' | '));
