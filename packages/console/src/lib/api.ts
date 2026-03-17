const BASE = '/api/v1';

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = {
    ...opts.headers,
  };

  // Use console session token if available
  const token = sessionStorage.getItem('console-token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
  };

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, init);

  if (res.status === 401) {
    sessionStorage.removeItem('console-token');
    sessionStorage.removeItem('console-did');
    window.location.href = `${import.meta.env.BASE_URL}login`;
    throw new ApiError(401, 'Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const json = JSON.parse(text);
      detail = json.detail || json.error || text;
    } catch {
      // use raw text
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

export { ApiError };
