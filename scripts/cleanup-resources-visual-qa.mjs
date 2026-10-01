import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const errors = [];
const checkedAt = new Date().toISOString();

const fixtureResults = [
  ['github-exact','GitHub','developer','FOUND','direct-api'],
  ['steam-community','Steam Community','gaming','FOUND','direct-api'],
  ['catalog-spotify','Spotify','media','POSSIBLE','catalog-rule'],
  ['catalog-example-social','Example Social','social','POSSIBLE','catalog-rule'],
  ['blocked','Blocked Example','other','BLOCKED','catalog-rule'],
].map(([sourceId, sourceName, category, status, evidenceBasis], index) => ({
  sourceId,
  sourceName,
  category,
  status,
  evidenceBasis,
  profileUrl: 'https://example.com/' + sourceId + '/cleanup_user',
  nsfw: false,
  confidence: status === 'FOUND' ? 'high' : status === 'POSSIBLE' ? 'medium' : 'none',
  reason: 'Cleanup-resource visual fixture.',
  httpStatus: status === 'BLOCKED' ? 403 : 200,
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
  total: 5,
  standard: 5,
  nsfw: 0,
  direct: 2,
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

const desktop = await browser.newPage({ viewport:{ width:1440, height:1050 }, deviceScaleFactor:1 });
await prepare(desktop, 'desktop');
await openSolo(desktop, 'cleanupcheck');

const github = row(desktop, 'GitHub');
if (await github.locator('.review-resource-panel').count()) errors.push('GitHub resources appeared before user review');

await github.getByRole('button', { name:'Mine', exact:true }).click();
if (await github.locator('.review-resource-panel').count()) errors.push('GitHub resources appeared before Clean up');

await github.getByRole('button', { name:'Clean up', exact:true }).click();
await github.locator('.review-resource-panel').waitFor({ state:'visible' });

const githubLinks = await github.locator('.review-resource-links a').evaluateAll((anchors) => anchors.map((a) => ({
  href: a.href,
  text: a.textContent?.replace(/\s+/g, ' ').trim(),
})));
if (githubLinks.length !== 2) errors.push('GitHub should expose two curated links: ' + JSON.stringify(githubLinks));
if (!githubLinks.every((link) => new URL(link.href).hostname === 'docs.github.com')) {
  errors.push('GitHub cleanup links did not stay on docs.github.com: ' + JSON.stringify(githubLinks));
}
if (!githubLinks.some((link) => /Delete your GitHub account/.test(link.text || ''))) errors.push('GitHub delete guide missing');
if (!githubLinks.some((link) => /Keep commit email private/.test(link.text || ''))) errors.push('GitHub email privacy guide missing');

const steam = row(desktop, 'Steam Community');
await steam.getByRole('button', { name:'Mine', exact:true }).click();
await steam.getByRole('button', { name:'Clean up', exact:true }).click();
const steamHosts = await steam.locator('.review-resource-links a').evaluateAll((anchors) => anchors.map((a) => new URL(a.href).hostname));
if (steamHosts.length !== 2 || steamHosts.some((host) => host !== 'help.steampowered.com')) {
  errors.push('Steam official links incorrect: ' + JSON.stringify(steamHosts));
}

const unsupported = row(desktop, 'Example Social');
await unsupported.getByRole('button', { name:'Mine', exact:true }).click();
await unsupported.getByRole('button', { name:'Clean up', exact:true }).click();
const unsupportedPanel = unsupported.locator('.review-resource-panel.unavailable');
if (await unsupportedPanel.count() !== 1) errors.push('Unsupported service did not show no-curated-guide fallback');
if (await unsupported.locator('.review-resource-panel a').count()) errors.push('Unsupported service received a guessed cleanup URL');

await github.getByRole('button', { name:'Keep', exact:true }).click();
if (await github.locator('.review-resource-panel').count()) errors.push('Cleanup drawer remained after switching GitHub to Keep');
await github.getByRole('button', { name:'Clean up', exact:true }).click();

await desktop.locator('.account-review').scrollIntoViewIfNeeded();
await desktop.locator('.account-review').screenshot({ path:'cleanup-resources-desktop.jpg', type:'jpeg', quality:70 });

const mobile = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
await prepare(mobile, 'mobile');
await openSolo(mobile, 'cleanupmobile');

const mobileGithub = row(mobile, 'GitHub');
await mobileGithub.getByRole('button', { name:'Mine', exact:true }).click();
await mobileGithub.getByRole('button', { name:'Clean up', exact:true }).click();
await mobileGithub.locator('.review-resource-panel').waitFor({ state:'visible' });
await mobileGithub.scrollIntoViewIfNeeded();

const docWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
if (docWidth > 390) errors.push('mobile document horizontal overflow: ' + docWidth);

const mobileResourceWidth = await mobileGithub.locator('.review-resource-panel').evaluate((element) => ({
  width: Math.round(element.getBoundingClientRect().width),
  scrollWidth: element.scrollWidth,
  clientWidth: element.clientWidth,
}));
if (mobileResourceWidth.scrollWidth > mobileResourceWidth.clientWidth) {
  errors.push('cleanup resource drawer has internal horizontal overflow: ' + JSON.stringify(mobileResourceWidth));
}

await mobile.screenshot({ path:'cleanup-resources-mobile.jpg', type:'jpeg', quality:70, fullPage:false });

for (const path of ['cleanup-resources-desktop.jpg','cleanup-resources-mobile.jpg']) {
  const base64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(base64);
  console.log('SCREENSHOT_END ' + path);
}

console.log('CLEANUP_VISUAL_QA ' + JSON.stringify({
  errors,
  docWidth,
  githubLinks: githubLinks.map((link) => new URL(link.href).hostname),
  steamHosts,
  mobileResourceWidth,
}));
await browser.close();

if (errors.length) throw new Error('Cleanup resource visual QA failed: ' + errors.join(' | '));
