export type ResultStatus = 'FOUND' | 'POSSIBLE' | 'NOT_FOUND' | 'UNKNOWN' | 'BLOCKED' | 'SKIPPED';
export type Confidence = 'high' | 'medium' | 'low' | 'none';
export type SourceCategory = 'social' | 'developer' | 'gaming' | 'creative' | 'media' | 'community' | 'adult' | 'other';

export interface EvidenceSignal {
  kind: 'identity' | 'status' | 'negative' | 'block' | 'error' | 'provenance';
  detail: string;
}

export interface SourceResult {
  sourceId: string;
  sourceName: string;
  profileUrl: string;
  category: SourceCategory;
  nsfw: boolean;
  status: ResultStatus;
  confidence: Confidence;
  reason: string;
  httpStatus: number | null;
  checkedAt: string;
  durationMs: number;
  signals: EvidenceSignal[];
}

export interface SearchResponse {
  query: string;
  kind: 'username';
  checkedAt: string;
  sourceCount: number;
  batchCount: number;
  includeNsfw: boolean;
  nextCursor: number | null;
  results: SourceResult[];
  summary: Record<ResultStatus, number>;
}
