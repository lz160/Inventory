export class ImsApiError extends Error {
  public readonly httpStatus: number;
  public readonly code: number;

  constructor(httpStatus: number, code: number, message: string) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
    this.name = 'ImsApiError';
  }
}

// Memory-only Bearer token (never persisted to localStorage or sessionStorage)
let inMemoryAuthToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setImsAuthToken(token: string | null): void {
  inMemoryAuthToken = token ? token.trim() : null;
}

export function getImsAuthToken(): string | null {
  return inMemoryAuthToken;
}

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function getAuthHeaders(extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders || {});
  if (inMemoryAuthToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryAuthToken}`);
  }
  return headers;
}

export function parseImsEnvelope<T>(status: number, ok: boolean, text: string): T {
  let payload: any = null;
  const trimmed = text.trim();
  if (trimmed) {
    try {
      payload = JSON.parse(trimmed);
    } catch {
      if (ok) {
        throw new ImsApiError(status, 50000, '服务器返回了无效的数据格式');
      }
      payload = null;
    }
  }

  if (!ok || (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0)) {
    const errCode = Number(payload?.code || 50000);
    const msg = payload?.message || payload?.error || `HTTP ${status} 请求失败`;
    throw new ImsApiError(status, errCode, msg);
  }

  if (status === 204) {
    return undefined as T;
  }

  if (!payload || typeof payload !== 'object' || !('code' in payload)) {
    throw new ImsApiError(status, 50000, '服务器返回了无效的响应结构');
  }

  return payload.data as T;
}

export async function imsFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = getAuthHeaders(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const text = await res.text();

  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    inMemoryAuthToken = null;
    unauthorizedHandler?.();
  }

  return parseImsEnvelope<T>(res.status, res.ok, text);
}

export async function downloadImsXlsx(url: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(url, {
    headers: getAuthHeaders(),
  });

  if (res.status === 401) {
    inMemoryAuthToken = null;
    unauthorizedHandler?.();
  }

  if (!res.ok) {
    let msg = `导出失败 (HTTP ${res.status})`;
    try {
      const json = await res.json();
      if (json?.message) msg = json.message;
    } catch {}
    throw new ImsApiError(res.status, 50000, msg);
  }

  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = fallbackFilename;
  a.click();
  URL.revokeObjectURL(objUrl);
}

export function formatQty(val: number | null | undefined): string {
  if (val === null || val === undefined) return '0';
  const num = Number(val);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatEur(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—';
  const num = Number(val);
  if (!Number.isFinite(num)) return '—';
  return `€${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
