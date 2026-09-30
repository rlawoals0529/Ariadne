export type ResultStatus = 'FOUND' | 'NOT_FOUND' | 'UNKNOWN' | 'BLOCKED' | 'SKIPPED';
export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface EvidenceSignal {
  kind: 'identity' | 'status' | 'negative' | 'block' | 'error';
  detail: string;
}

export interface SourceResult {
  sourceId: string;
  sourceName: string;
  profileUrl: string;
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
  results: SourceResult[];
  summary: Record<ResultStatus, number>;
}
