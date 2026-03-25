import type { ServerResponse } from 'node:http';

import type { ProblemDetail } from '../protocol/index.js';

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface Links {
  self: string;
  next?: string | null;
  prev?: string | null;
  first?: string | null;
  last?: string | null;
  [key: string]: string | null | undefined;
}

function toJson(body: unknown): string {
  return JSON.stringify(body, (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  contentType = 'application/json; charset=utf-8',
): void {
  const payload = toJson(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function ok<T>(res: ServerResponse, data: T, links?: Links): void {
  send(res, 200, links ? { data, links } : { data });
}

export function created<T>(res: ServerResponse, data: T, links?: Links): void {
  if (links?.self) {
    res.setHeader('Location', links.self);
  }
  send(res, 201, links ? { data, links } : { data });
}

export function noContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export function paginated<T>(
  res: ServerResponse,
  data: T[],
  opts: { page: number; perPage: number; total: number; basePath: string; query?: Record<string, string> },
): void {
  const { page, perPage, total, basePath, query = {} } = opts;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const buildUrl = (targetPage: number): string => {
    const params = new URLSearchParams({ ...query, page: String(targetPage), per_page: String(perPage) });
    return `${basePath}?${params.toString()}`;
  };

  send(res, 200, {
    data,
    meta: {
      pagination: {
        page,
        perPage,
        total,
        totalPages,
      },
    },
    links: {
      self: buildUrl(page),
      first: buildUrl(1),
      last: buildUrl(totalPages),
      prev: page > 1 ? buildUrl(page - 1) : null,
      next: page < totalPages ? buildUrl(page + 1) : null,
    },
  });
}

export function problem(res: ServerResponse, detail: ProblemDetail): void {
  send(res, detail.status, detail, 'application/problem+json; charset=utf-8');
}

export function parsePagination(searchParams: URLSearchParams): { page: number; perPage: number; offset: number } {
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('per_page') ?? '20', 10) || 20));
  return {
    page,
    perPage,
    offset: (page - 1) * perPage,
  };
}
