export type CleanupResourceKind = 'delete' | 'privacy' | 'profile';

export type CleanupResource = {
  label: string;
  kind: CleanupResourceKind;
  url: string;
  note: string;
};

export type CleanupResourceSet = {
  service: string;
  resources: CleanupResource[];
  checkedAt: string;
};

const CHECKED_AT = '2026-09-30';

const byName: Record<string, CleanupResourceSet> = {
  github: {
    service: 'GitHub',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Delete your GitHub account',
        kind: 'delete',
        url: 'https://docs.github.com/en/account-and-profile/how-tos/account-management/deleting-your-personal-account',
        note: 'GitHub explains what is removed and what should be backed up first.',
      },
      {
        label: 'Keep commit email private',
        kind: 'privacy',
        url: 'https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address',
        note: 'Use GitHub’s noreply address and email-privacy setting for future commits.',
      },
    ],
  },
  gitlab: {
    service: 'GitLab',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Delete your GitLab account',
        kind: 'delete',
        url: 'https://docs.gitlab.com/user/profile/account/delete_account/',
        note: 'Official steps for scheduling your own GitLab account for deletion.',
      },
      {
        label: 'Make your GitLab profile private',
        kind: 'privacy',
        url: 'https://docs.gitlab.com/user/profile/',
        note: 'GitLab documents its Private profile setting and what it does not hide.',
      },
    ],
  },
  reddit: {
    service: 'Reddit',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Delete your Reddit account',
        kind: 'delete',
        url: 'https://support.reddithelp.com/hc/en-us/articles/204579509-How-do-I-delete-my-account',
        note: 'Reddit notes that deleting the account does not automatically delete posts or comments.',
      },
    ],
  },
  tumblr: {
    service: 'Tumblr',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Delete your Tumblr account or blog',
        kind: 'delete',
        url: 'https://help.tumblr.com/knowledge-base/delete-your-account-or-blog/',
        note: 'Deleting the primary blog deletes the Tumblr account.',
      },
      {
        label: 'Review Tumblr privacy options',
        kind: 'privacy',
        url: 'https://help.tumblr.com/knowledge-base/privacy-options/',
        note: 'Controls include search discoverability, external indexing, activity, likes, and following.',
      },
    ],
  },
  twitch: {
    service: 'Twitch',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Disable or delete your Twitch account',
        kind: 'delete',
        url: 'https://help.twitch.tv/s/article/delete-twitch-account',
        note: 'Twitch distinguishes reversible disabling from permanent deletion.',
      },
    ],
  },
  'steam community': {
    service: 'Steam',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Request Steam account deletion',
        kind: 'delete',
        url: 'https://help.steampowered.com/en/faqs/view/21A6-7C93-6CFE-100B',
        note: 'Steam explains the ownership verification and deletion process.',
      },
      {
        label: 'Change Steam profile privacy',
        kind: 'privacy',
        url: 'https://help.steampowered.com/en/faqs/view/588C-C67D-0251-C276',
        note: 'Steam profiles can be Public, Friends Only, or Private, with additional sub-controls.',
      },
    ],
  },
  youtube: {
    service: 'YouTube',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Hide or delete your YouTube channel',
        kind: 'delete',
        url: 'https://support.google.com/youtube/answer/55759',
        note: 'This affects the YouTube channel, not the Google Account used to sign in.',
      },
      {
        label: 'Edit your YouTube profile and handle',
        kind: 'profile',
        url: 'https://support.google.com/youtube/answer/2657964',
        note: 'Official controls for channel name, handle, description, picture, and links.',
      },
    ],
  },
  spotify: {
    service: 'Spotify',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Close your Spotify account and delete data',
        kind: 'delete',
        url: 'https://support.spotify.com/us/article/how-can-i-close-my-spotify-account/',
        note: 'Spotify documents account closure, data deletion, and its short reactivation window.',
      },
      {
        label: 'Review Spotify privacy and social controls',
        kind: 'privacy',
        url: 'https://support.spotify.com/us/article/privacy-and-social-controls/',
        note: 'Controls include listening activity, followers, recently played artists, and public playlists.',
      },
    ],
  },
  'x / twitter': {
    service: 'X',
    checkedAt: CHECKED_AT,
    resources: [
      {
        label: 'Deactivate your X account',
        kind: 'delete',
        url: 'https://help.x.com/en/managing-your-account/how-to-deactivate-x-account',
        note: 'X uses a deactivation period before account deletion completes.',
      },
    ],
  },
};

const nameAliases: Record<string, string> = {
  'steam': 'steam community',
  'steam-community': 'steam community',
  'catalog-steam-community': 'steam community',
  'catalog-spotify': 'spotify',
  'catalog-x-twitter': 'x / twitter',
  'catalog-tumblr': 'tumblr',
  'catalog-youtube': 'youtube',
  'catalog-twitch': 'twitch',
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function getCleanupResources(sourceId: string, sourceName: string): CleanupResourceSet | null {
  const idKey = normalize(sourceId);
  const nameKey = normalize(sourceName);
  const idAlias = nameAliases[idKey];
  if (idAlias && byName[idAlias]) return byName[idAlias];
  if (byName[idKey]) return byName[idKey];
  if (byName[nameKey]) return byName[nameKey];
  return null;
}

export function cleanupResourceCoverage() {
  return Object.values(byName).map((entry) => ({
    service: entry.service,
    resourceCount: entry.resources.length,
    checkedAt: entry.checkedAt,
  }));
}
