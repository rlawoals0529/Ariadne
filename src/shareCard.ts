import type { FriendMetrics } from './friendGames.js';

const WIDTH = 1200;
const HEIGHT = 675;

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value;
}

function rows<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function text(value: string) {
  return escapeXml(value);
}

export function buildFriendShareCardSvg(metrics: FriendMetrics) {
  const participants = metrics.participants.slice(0, 6);
  const handleRows = rows(participants.map((participant) => `@${truncate(participant.query, 22)}`), 3);
  const foundTotal = participants.reduce((sum, participant) => sum + participant.confirmed, 0);
  const maybeTotal = participants.reduce((sum, participant) => sum + participant.possible, 0);
  const sharedSites = metrics.shared.slice(0, 6);
  const handleMarkup = handleRows.map((row, rowIndex) => (
    `<text x="72" y="${166 + rowIndex * 52}" font-family="Georgia, 'Times New Roman', serif" font-size="38" fill="#1c1a18">${text(row.join(' × '))}</text>`
  )).join('');

  const stats = [
    ['People', String(participants.length)],
    ['Shared', String(metrics.shared.length)],
    ['Everyone', String(metrics.everyoneSites.length)],
    ['Found', String(foundTotal)],
    ['Maybe', String(maybeTotal)],
  ];

  const statsMarkup = stats.map(([label, value], index) => {
    const x = 72 + index * 211;
    return `<g transform="translate(${x} 300)">
      <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" letter-spacing="2" fill="#756d63">${label.toUpperCase()}</text>
      <text x="0" y="54" font-family="Georgia, 'Times New Roman', serif" font-size="44" fill="#1c1a18">${value}</text>
    </g>`;
  }).join('');

  const sharedMarkup = sharedSites.length
    ? sharedSites.map((site, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 72 + column * 344;
      const y = 438 + row * 48;
      return `<g transform="translate(${x} ${y})">
        <rect width="320" height="34" rx="1" fill="#f5f0e7" stroke="#c9c0b4" />
        <text x="14" y="22" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#1c1a18">${text(truncate(site, 31))}</text>
      </g>`;
    }).join('')
    : '<text x="72" y="462" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#756d63">No shared Found or Maybe sites appeared in this comparison.</text>';

  const moreShared = metrics.shared.length > sharedSites.length
    ? `<text x="72" y="552" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#756d63">+${metrics.shared.length - sharedSites.length} more shared site${metrics.shared.length - sharedSites.length === 1 ? '' : 's'}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
    <title id="title">Ariadne friend footprint card</title>
    <desc id="desc">A scan-derived summary of public username profile signals. It does not claim identity or account ownership.</desc>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#f5f0e7" />
    <rect x="28" y="28" width="1144" height="619" fill="#fbf8f1" stroke="#1c1a18" />
    <rect x="28" y="28" width="1144" height="5" fill="#a83f32" />

    <g transform="translate(72 67)">
      <circle cx="18" cy="18" r="17" fill="none" stroke="#1c1a18" />
      <text x="18" y="24" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="19" fill="#1c1a18">A</text>
      <text x="51" y="16" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" letter-spacing="5" fill="#1c1a18">ARIADNE</text>
      <text x="51" y="38" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700" letter-spacing="2" fill="#756d63">FRIEND FOOTPRINT · PUBLIC PROFILE SIGNALS</text>
    </g>

    ${handleMarkup}
    <text x="72" y="${handleRows.length > 1 ? 282 : 230}" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#756d63">${metrics.shared.length} public site${metrics.shared.length === 1 ? '' : 's'} appeared for more than one username · ${metrics.verifiedShared.length} Found for at least two</text>

    <line x1="72" y1="278" x2="1128" y2="278" stroke="#c9c0b4" />
    ${statsMarkup}

    <text x="72" y="410" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="800" letter-spacing="2.2" fill="#a83f32">SHARED PATHS</text>
    ${sharedMarkup}
    ${moreShared}

    <line x1="72" y1="584" x2="1128" y2="584" stroke="#c9c0b4" />
    <text x="72" y="612" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#756d63">Built locally from this scan. Found and Maybe stay separate in Ariadne.</text>
    <text x="72" y="635" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#756d63">Matching usernames are public signals, not proof that accounts belong to the same person.</text>
  </svg>`;
}
