export type ApiResult<T> = {
  ok: boolean;
  data?: T;
  message?: string;
  status: number;
};

export type RuntimeStatus = {
  mode: 'paper' | 'testnet';
  validateOnly: boolean;
  ts: string;
};

export type HealthPayload = {
  ok: true;
  ts: string;
};

export type ReportPayload = {
  generatedAt?: string;
  symbol?: string;
  interval?: string;
  strategy?: string;
  metrics?: {
    totalReturn?: number;
    maxDrawdown?: number;
    winRate?: number;
    profitFactor?: number;
    numberOfTrades?: number;
  };
  equityCurve?: number[];
  trades?: Array<Record<string, unknown>>;
};

export type PaperTailItem = Record<string, unknown>;

export type JournalPayload =
  | { format: 'json'; data: Record<string, unknown> }
  | { format: 'markdown'; data: string };

async function getJson<T>(url: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: typeof body?.message === 'string' ? body.message : 'คำขอล้มเหลว'
      };
    }

    if (body && typeof body === 'object' && 'ok' in body && 'data' in body) {
      return {
        ok: true,
        status: response.status,
        data: body.data as T,
        message: typeof body.message === 'string' ? body.message : undefined
      };
    }

    return {
      ok: true,
      status: response.status,
      data: body as T,
      message: typeof body?.message === 'string' ? body.message : undefined
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function fetchRuntimeStatus(): Promise<ApiResult<RuntimeStatus>> {
  return getJson<RuntimeStatus>('/api/runtime/status');
}

export async function fetchHealth(): Promise<ApiResult<HealthPayload>> {
  return getJson<HealthPayload>('/api/health');
}

export async function fetchLatestReport(): Promise<ApiResult<ReportPayload>> {
  return getJson<ReportPayload>('/api/report/latest');
}

export async function fetchPaperTail(lines = 500): Promise<ApiResult<{ items: PaperTailItem[]; message?: string }>> {
  const safeLines = Math.max(1, Math.min(5000, Math.floor(lines)));
  return getJson<{ items: PaperTailItem[]; message?: string }>(`/api/paper/tail?lines=${safeLines}`);
}

export async function fetchPaperRead(params: {
  from?: number;
  to?: number;
  maxLines?: number;
}): Promise<ApiResult<{ items: PaperTailItem[]; count: number; scannedLines: number; from: number | null; to: number | null; maxLines: number }>> {
  const query = new URLSearchParams();
  if (typeof params.from === 'number' && Number.isFinite(params.from)) query.set('from', String(Math.floor(params.from)));
  if (typeof params.to === 'number' && Number.isFinite(params.to)) query.set('to', String(Math.floor(params.to)));
  if (typeof params.maxLines === 'number' && Number.isFinite(params.maxLines)) {
    query.set('maxLines', String(Math.floor(params.maxLines)));
  }
  const suffix = query.toString();
  return getJson(`/api/paper/read${suffix ? `?${suffix}` : ''}`);
}

export async function fetchLatestJournal(): Promise<ApiResult<JournalPayload>> {
  return getJson<JournalPayload>('/api/journal/latest');
}
