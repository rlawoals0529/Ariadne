import { getCleanupResources } from './cleanupResources.js';
import type { AccountReviewState } from './reviewState.js';
import type { SearchResponse } from './shared/types.js';

function escapeMarkdown(value: string) {
  return value.replace(/([\\*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

function formatStatus(status: SearchResponse['results'][number]['status']) {
  if (status === 'FOUND') return 'Found';
  if (status === 'POSSIBLE') return 'Maybe';
  return status;
}

export function buildCleanupChecklistMarkdown(
  data: SearchResponse,
  reviews: AccountReviewState,
  generatedAt = new Date().toISOString(),
) {
  const actionable = data.results
    .filter((result) => {
      const review = reviews[result.sourceId];
      return review?.ownership === 'mine' && (review.action === 'cleanup' || review.action === 'done');
    })
    .sort((a, b) => {
      const aDone = reviews[a.sourceId]?.action === 'done' ? 1 : 0;
      const bDone = reviews[b.sourceId]?.action === 'done' ? 1 : 0;
      return aDone - bDone || a.sourceName.localeCompare(b.sourceName);
    });

  const lines = [
    '# Ariadne cleanup checklist',
    '',
    'Username: @' + escapeMarkdown(data.query),
    'Generated: ' + generatedAt,
    '',
    'This export contains only accounts you marked Mine and then Clean up or Done.',
    'Those ownership labels are your review decisions; Ariadne does not infer ownership from a matching username.',
    '',
  ];

  if (!actionable.length) {
    lines.push('No cleanup items are currently selected.');
    return lines.join('\n');
  }

  for (const result of actionable) {
    const review = reviews[result.sourceId]!;
    const done = review.action === 'done';
    const resources = getCleanupResources(result.sourceId, result.sourceName);

    lines.push('- [' + (done ? 'x' : ' ') + '] ' + escapeMarkdown(result.sourceName) + ' — ' + (done ? 'Done' : 'Clean up'));
    lines.push('  - Evidence: ' + formatStatus(result.status));
    lines.push('  - Profile: <' + result.profileUrl + '>');

    if (resources?.resources.length) {
      lines.push('  - Official resources:');
      for (const resource of resources.resources) {
        lines.push('    - ' + escapeMarkdown(resource.label) + ': <' + resource.url + '>');
      }
    } else {
      lines.push('  - Official resources: No curated guide in Ariadne yet.');
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function cleanupChecklistFilename(query: string) {
  const safe = query.trim().toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return 'ariadne-cleanup-' + (safe || 'review') + '.md';
}
