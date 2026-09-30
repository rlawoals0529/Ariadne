import type { Confidence, EvidenceSignal, ResultStatus } from '../shared/types.js';

export interface Verdict {
  status: ResultStatus;
  confidence: Confidence;
  reason: string;
  signals: EvidenceSignal[];
}

export function classifyHttpFailure(status: number): Verdict | null {
  if (status === 403 || status === 429) {
    return {
      status: 'BLOCKED',
      confidence: 'none',
      reason: status === 429 ? 'The source rate-limited this check.' : 'The source refused automated verification.',
      signals: [{ kind: 'block', detail: `HTTP ${status}` }],
    };
  }

  if (status >= 500) {
    return {
      status: 'UNKNOWN',
      confidence: 'none',
      reason: 'The source returned a server error, so account existence cannot be determined.',
      signals: [{ kind: 'error', detail: `HTTP ${status}` }],
    };
  }

  return null;
}

export function apiIdentityVerdict(options: {
  httpStatus: number;
  expected: string;
  actual?: string | null;
  missing?: boolean;
}): Verdict {
  const infrastructure = classifyHttpFailure(options.httpStatus);
  if (infrastructure) return infrastructure;

  if (options.httpStatus === 404 || options.missing) {
    return {
      status: 'NOT_FOUND',
      confidence: 'high',
      reason: 'The source API explicitly reports no matching account.',
      signals: [
        { kind: 'status', detail: `HTTP ${options.httpStatus}` },
        { kind: 'negative', detail: 'Source-specific API returned an explicit missing result.' },
      ],
    };
  }

  if (options.httpStatus >= 200 && options.httpStatus < 300 && options.actual) {
    if (options.actual.toLocaleLowerCase() === options.expected.toLocaleLowerCase()) {
      return {
        status: 'FOUND',
        confidence: 'high',
        reason: 'The public API returned the requested account identifier.',
        signals: [
          { kind: 'status', detail: `HTTP ${options.httpStatus}` },
          { kind: 'identity', detail: `API identifier matched “${options.actual}”.` },
        ],
      };
    }

    return {
      status: 'UNKNOWN',
      confidence: 'none',
      reason: 'The API returned a different identifier, so Ariadne will not infer a match.',
      signals: [
        { kind: 'status', detail: `HTTP ${options.httpStatus}` },
        { kind: 'error', detail: `Expected “${options.expected}”, received “${options.actual}”.` },
      ],
    };
  }

  return {
    status: 'UNKNOWN',
    confidence: 'none',
    reason: 'The response did not contain enough evidence to make a claim.',
    signals: [{ kind: 'status', detail: `HTTP ${options.httpStatus}` }],
  };
}
