import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.ARIADNE_URL || 'https://ariadne.rlawoals0529.workers.dev';
const browser = await chromium.launch({ headless: true });
const errors = [];

async function attachLogging(page, label) {
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(label + ' console: ' + msg.text()); });
  page.on('pageerror', (error) => errors.push(label + ' pageerror: ' + error.message));
}

async function scan(page, username) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  const input = page.locator('input').first();
  await input.fill(username);
  const searchButton = page.getByRole('button', { name: /search|scan|trace|find/i }).first();
  await searchButton.click();
  await page.locator('.profile-summary').waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(2500);
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await attachLogging(desktop, 'desktop');
await scan(desktop, 'octocat');
await desktop.screenshot({ path: 'desktop-result.jpg', type: 'jpeg', quality: 55, fullPage: true });
await desktop.locator('.scan-insights > summary').click();
await desktop.locator('.source-availability > summary').click();
await desktop.screenshot({ path: 'desktop-expanded.jpg', type: 'jpeg', quality: 55, fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await attachLogging(mobile, 'mobile');
await scan(mobile, 'octocat');
await mobile.locator('#evidence-explorer').scrollIntoViewIfNeeded();
await mobile.screenshot({ path: 'mobile-evidence.jpg', type: 'jpeg', quality: 55, fullPage: true });
await mobile.locator('.category-menu > summary').click();
await mobile.screenshot({ path: 'mobile-category.jpg', type: 'jpeg', quality: 55, fullPage: false });

const longText = '@' + 'averylongusername'.repeat(4);
await mobile.locator('.profile-identity h3').evaluate((el, text) => { el.textContent = text; }, longText);
await mobile.locator('.profile-summary').scrollIntoViewIfNeeded();
await mobile.screenshot({ path: 'mobile-long-username.jpg', type: 'jpeg', quality: 55, fullPage: false });

for (const selector of ['.profile-summary', '.scan-support-stack', '#evidence-explorer', '.results-list']) {
  const box = await mobile.locator(selector).boundingBox();
  if (box && box.x + box.width > 391) errors.push('overflow ' + selector + ': ' + (box.x + box.width));
}

for (const path of ['desktop-result.jpg','desktop-expanded.jpg','mobile-evidence.jpg','mobile-category.jpg','mobile-long-username.jpg']) {
  const b64 = fs.readFileSync(path).toString('base64');
  console.log('SCREENSHOT_BEGIN ' + path);
  console.log(b64);
  console.log('SCREENSHOT_END ' + path);
}
console.log('VISUAL_QA_ERRORS ' + JSON.stringify(errors));
await browser.close();
