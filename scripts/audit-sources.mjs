import { exactSources } from '../.test-dist/worker/exactSources.js';
import { extendedCatalogStats } from '../.test-dist/worker/extendedCatalog.js';
import { searchableSourceStats, selectSources } from '../.test-dist/worker/search.js';

const selected = selectSources(false, {});
const stats = searchableSourceStats({});
const ids = selected.map((source) => source.id);
const names = selected.map((source) => source.name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
const httpsFailures = selected
  .map((source) => ({ name: source.name, url: source.profileUrl('ariadne_audit') }))
  .filter((item) => !item.url.startsWith('https://'));

const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
const directShare = Math.round((stats.direct / Math.max(1, stats.standard)) * 1000) / 10;
const broad = extendedCatalogStats.rules;

console.log('Ariadne source quality audit');
console.log('----------------------------');
console.log(`Standard searchable sources : ${stats.standard}`);
console.log(`Opt-in adult sources        : ${stats.nsfw}`);
console.log(`Direct / exact checks       : ${stats.direct} (${directShare}% of standard)`);
console.log(`Broad / heuristic checks    : ${stats.heuristic}`);
console.log(`Exact adapter definitions   : ${exactSources.length}`);
console.log(`Extended catalog rules      : ${extendedCatalogStats.total}`);
console.log('');
console.log('Extended rule composition');
console.log(`  status-code rules         : ${broad.statusCode}`);
console.log(`  message rules             : ${broad.message}`);
console.log(`  redirect rules            : ${broad.responseUrl}`);
console.log(`  dedicated probe URLs      : ${broad.withProbe}`);
console.log(`  username validators       : ${broad.withRegex}`);
console.log(`  status-only rules         : ${broad.statusOnly}`);
console.log('');
console.log('Broad rule quality tiers');
console.log(`  dedicated probe           : ${extendedCatalogStats.qualityTiers.dedicatedProbe}`);
console.log(`  explicit negative signal  : ${extendedCatalogStats.qualityTiers.explicitNegative}`);
console.log(`  status + validator        : ${extendedCatalogStats.qualityTiers.statusWithValidator}`);
console.log(`  status + body evidence    : ${extendedCatalogStats.qualityTiers.statusWithBodyEvidence}`);
console.log(`  provenance                : ${extendedCatalogStats.provenance}`);

const failures = [];
if (duplicateIds.length) failures.push(`duplicate source ids: ${[...new Set(duplicateIds)].join(', ')}`);
if (duplicateNames.length) failures.push(`duplicate selected names: ${[...new Set(duplicateNames)].join(', ')}`);
if (httpsFailures.length) failures.push(`non-HTTPS profile URLs: ${httpsFailures.map((item) => item.name).join(', ')}`);
if (stats.standard < 329) failures.push(`standard source count fell below 329 (got ${stats.standard})`);
if (stats.direct < 65) failures.push(`direct/exact count fell below 65 (got ${stats.direct})`);
if (extendedCatalogStats.total < 224) failures.push(`extended rule count fell below 224 (got ${extendedCatalogStats.total})`);
if (exactSources.length < 56) failures.push(`exact adapter definitions fell below 56 (got ${exactSources.length})`);
if (directShare < 19) failures.push(`direct/exact share fell below 19% (got ${directShare}%)`);
if (extendedCatalogStats.qualityTiers.statusWithBodyEvidence > 100) failures.push(`weak status/body-evidence tier exceeded 100 rules (got ${extendedCatalogStats.qualityTiers.statusWithBodyEvidence})`);

if (failures.length) {
  console.error('\nAudit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nAudit passed.');
}
