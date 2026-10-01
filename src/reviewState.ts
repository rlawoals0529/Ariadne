export type ReviewOwnership = 'mine' | 'not-mine' | 'unsure';
export type ReviewAction = 'keep' | 'cleanup' | 'done';

export type AccountReviewRecord = {
  ownership?: ReviewOwnership;
  action?: ReviewAction;
  updatedAt: string;
};

export type AccountReviewState = Record<string, AccountReviewRecord>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_PREFIX = 'ariadne:account-review:v1:';

function isOwnership(value: unknown): value is ReviewOwnership {
  return value === 'mine' || value === 'not-mine' || value === 'unsure';
}

function isAction(value: unknown): value is ReviewAction {
  return value === 'keep' || value === 'cleanup' || value === 'done';
}

export function reviewStorageKey(query: string) {
  return STORAGE_PREFIX + encodeURIComponent(query.trim().toLowerCase());
}

export function normalizeAccountReviews(input: unknown): AccountReviewState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output: AccountReviewState = {};

  for (const [sourceId, rawRecord] of Object.entries(input)) {
    if (!sourceId || !rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) continue;
    const record = rawRecord as Record<string, unknown>;
    const ownership = isOwnership(record.ownership) ? record.ownership : undefined;
    const action = ownership === 'mine' && isAction(record.action) ? record.action : undefined;
    const updatedAt = typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : '';

    if (!ownership && !action) continue;
    output[sourceId] = {
      ...(ownership ? { ownership } : {}),
      ...(action ? { action } : {}),
      updatedAt,
    };
  }

  return output;
}

export function readAccountReviews(storage: StorageLike, query: string): AccountReviewState {
  if (!query.trim()) return {};
  try {
    const raw = storage.getItem(reviewStorageKey(query));
    return raw ? normalizeAccountReviews(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeAccountReviews(storage: StorageLike, query: string, state: AccountReviewState) {
  if (!query.trim()) return;
  try {
    const normalized = normalizeAccountReviews(state);
    if (Object.keys(normalized).length === 0) storage.removeItem(reviewStorageKey(query));
    else storage.setItem(reviewStorageKey(query), JSON.stringify(normalized));
  } catch {
    // Local review state is optional. Ariadne should still work if storage is unavailable.
  }
}

export function clearAccountReviews(storage: StorageLike, query: string) {
  if (!query.trim()) return;
  try {
    storage.removeItem(reviewStorageKey(query));
  } catch {
    // Ignore storage failures so the rest of Ariadne remains usable.
  }
}

export function updateAccountReview(
  state: AccountReviewState,
  sourceId: string,
  patch: { ownership?: ReviewOwnership | null; action?: ReviewAction | null },
  now = new Date().toISOString(),
): AccountReviewState {
  if (!sourceId) return state;

  const current = state[sourceId] ?? { updatedAt: now };
  const nextOwnership = patch.ownership === null
    ? undefined
    : patch.ownership ?? current.ownership;

  let nextAction = patch.action === null
    ? undefined
    : patch.action ?? current.action;

  if (nextOwnership !== 'mine') nextAction = undefined;

  if (!nextOwnership && !nextAction) {
    const { [sourceId]: _removed, ...rest } = state;
    return rest;
  }

  return {
    ...state,
    [sourceId]: {
      ...(nextOwnership ? { ownership: nextOwnership } : {}),
      ...(nextAction ? { action: nextAction } : {}),
      updatedAt: now,
    },
  };
}
