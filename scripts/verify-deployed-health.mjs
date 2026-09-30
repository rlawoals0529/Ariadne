import fs from 'node:fs';

const baseUrl = process.argv[2]?.replace(/\/$/, '');
if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  console.error('Usage: node scripts/verify-deployed-health.mjs https://<worker>.workers.dev');
  process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expected = { service: 'ariadne', version: pkg.version };
const attempts = 12;
const delayMs = 2_000;
let lastError = 'No response received';

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const healthResponse = await fetch(`${baseUrl}/api/health?verify=${Date.now()}-${attempt}`, {
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    });
    const healthText = await healthResponse.text();

    if (!healthResponse.ok) {
      lastError = `health HTTP ${healthResponse.status}: ${healthText.slice(0, 300)}`;
    } else {
      const health = JSON.parse(healthText);
      const healthMatches = health.ok === true && health.service === expected.service && health.version === expected.version;
      if (!healthMatches) {
        lastError = `health metadata mismatch: ${healthText.slice(0, 300)}`;
      } else {
        const pageResponse = await fetch(`${baseUrl}/?verify=${Date.now()}-${attempt}`, {
          headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
        });
        const html = await pageResponse.text();
        if (pageResponse.ok && /<title>Ariadne — follow the thread<\/title>/.test(html)) {
          console.log(JSON.stringify(health));
          console.log(`Verified Ariadne ${expected.version} API and application shell on attempt ${attempt}.`);
          process.exit(0);
        }
        lastError = `application shell verification failed: HTTP ${pageResponse.status}`;
      }
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  console.error(`Deployment verification attempt ${attempt}/${attempts} not ready: ${lastError}`);
  if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

console.error(`Deployed Ariadne never matched this repository checkout: ${lastError}`);
process.exit(1);
