/**
 * Standardized HTTP response helpers.
 *
 * All 2xx responses use the envelope: { data, meta?, links? }
 * All errors use RFC 7807 Problem Details: { type, title, status, detail, instance }
 */

import type { ServerResponse } from 'node:http';

// ─── Types ──────────────────────────────────────────────────────

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

export interface SingleResponse<T> {
  data: T;
  links?: Links;
}

export interface CollectionResponse<T> {
  data: T[];
  meta: { pagination: PaginationMeta };
  links: Links;
}

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

// ─── Constants ──────────────────────────────────────────────────

const ERROR_BASE_URL = 'https://clawnet.dev/errors';

export const ErrorTypes = {
  VALIDATION: `${ERROR_BASE_URL}/validation-error`,
  UNAUTHORIZED: `${ERROR_BASE_URL}/unauthorized`,
  FORBIDDEN: `${ERROR_BASE_URL}/forbidden`,
  NOT_FOUND: `${ERROR_BASE_URL}/not-found`,
  CONFLICT: `${ERROR_BASE_URL}/conflict`,
  UNPROCESSABLE: `${ERROR_BASE_URL}/unprocessable-entity`,
  INTERNAL: `${ERROR_BASE_URL}/internal-error`,
  METHOD_NOT_ALLOWED: `${ERROR_BASE_URL}/method-not-allowed`,
} as const;

// ─── Response Helpers ───────────────────────────────────────────

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

/** 200 OK — single resource */
export function ok<T>(res: ServerResponse, data: T, links?: Links): void {
  const body: SingleResponse<T> = { data };
  if (links) body.links = links;
  send(res, 200, body);
}

/** 201 Created — resource just created */
export function created<T>(res: ServerResponse, data: T, links?: Links): void {
  const body: SingleResponse<T> = { data };
  if (links) body.links = links;
  if (links?.self) {
    res.setHeader('Location', links.self);
  }
  send(res, 201, body);
}

/** 204 No Content — successful action with no body (e.g. DELETE) */
export function noContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

/** 200 OK — paginated collection */
export function paginated<T>(
  res: ServerResponse,
  data: T[],
  opts: {
    page: number;
    perPage: number;
    total: number;
    basePath: string;
    query?: Record<string, string>;
  },
): void {
  const { page, perPage, total, basePath, query = {} } = opts;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const buildUrl = (p: number): string => {
    const params = new URLSearchParams({ ...query, page: String(p), per_page: String(perPage) });
    return `${basePath}?${params.toString()}`;
  };

  const body: CollectionResponse<T> = {
    data,
    meta: {
      pagination: { page, perPage, total, totalPages },
    },
    links: {
      self: buildUrl(page),
      first: buildUrl(1),
      last: buildUrl(totalPages),
      prev: page > 1 ? buildUrl(page - 1) : null,
      next: page < totalPages ? buildUrl(page + 1) : null,
    },
  };
  send(res, 200, body);
}

// ─── Error Helpers (RFC 7807) ───────────────────────────────────

export function problem(res: ServerResponse, p: ProblemDetail): void {
  send(res, p.status, {
    type: p.type,
    title: p.title,
    status: p.status,
    detail: p.detail,
    instance: p.instance,
  });
}

export function badRequest(res: ServerResponse, detail: string, instance?: string): void {
  problem(res, {
    type: ErrorTypes.VALIDATION,
    title: 'Bad Request',
    status: 400,
    detail,
    instance,
  });
}

export function unauthorized(res: ServerResponse, detail?: string, instance?: string): void {
  problem(res, {
    type: ErrorTypes.UNAUTHORIZED,
    title: 'Unauthorized',
    status: 401,
    detail: detail ?? 'Authentication required',
    instance,
  });
}

export function forbidden(res: ServerResponse, detail?: string, instance?: string): void {
  problem(res, {
    type: ErrorTypes.FORBIDDEN,
    title: 'Forbidden',
    status: 403,
    detail: detail ?? 'Insufficient permissions',
    instance,
  });
}

export function notFound(res: ServerResponse, detail?: string, instance?: string): void {
  problem(res, {
    type: ErrorTypes.NOT_FOUND,
    title: 'Not Found',
    status: 404,
    detail: detail ?? 'Resource not found',
    instance,
  });
}

export function conflict(res: ServerResponse, detail: string, instance?: string): void {
  problem(res, {
    type: ErrorTypes.CONFLICT,
    title: 'Conflict',
    status: 409,
    detail,
    instance,
  });
}

export function unprocessable(res: ServerResponse, detail: string, instance?: string): void {
  problem(res, {
    type: ErrorTypes.UNPROCESSABLE,
    title: 'Unprocessable Entity',
    status: 422,
    detail,
    instance,
  });
}

export function methodNotAllowed(res: ServerResponse, allowed: string[], instance?: string): void {
  res.setHeader('Allow', allowed.join(', '));
  problem(res, {
    type: ErrorTypes.METHOD_NOT_ALLOWED,
    title: 'Method Not Allowed',
    status: 405,
    detail: `Allowed methods: ${allowed.join(', ')}`,
    instance,
  });
}

export function internalError(res: ServerResponse, detail?: string, instance?: string): void {
  problem(res, {
    type: ErrorTypes.INTERNAL,
    title: 'Internal Server Error',
    status: 500,
    detail: detail ?? 'An unexpected error occurred',
    instance,
  });
}

// ─── Pagination Param Parsing ───────────────────────────────────

export interface PaginationParams {
  page: number;
  perPage: number;
  offset: number;
}

export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') ?? '20', 10) || 20));
  return { page, perPage, offset: (page - 1) * perPage };
}

export function parseSort(searchParams: URLSearchParams): { field: string; order: 'asc' | 'desc' } | undefined {
  const sort = searchParams.get('sort');
  if (!sort) return undefined;
  if (sort.startsWith('-')) {
    return { field: sort.slice(1), order: 'desc' };
  }
  return { field: sort, order: 'asc' };
}
