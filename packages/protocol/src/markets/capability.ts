import { EventEnvelope } from '@claw-network/core/protocol';
import {
  createMarketListingPublishEnvelope,
  MarketListingPublishEventParams,
} from './events.js';
import { MarketListing } from './types.js';

export const CAPABILITY_TYPES = [
  'rest_api',
  'graphql_api',
  'grpc_api',
  'websocket',
  'tool',
  'llm',
  'vision',
  'audio',
  'embedding',
  'classification',
  'compute',
  'storage',
  'bandwidth',
  'gpu',
  'translation',
  'analysis',
  'search',
  'verification',
  'custom',
] as const;
export type CapabilityType = (typeof CAPABILITY_TYPES)[number];

export function isCapabilityType(value: string): value is CapabilityType {
  return (CAPABILITY_TYPES as readonly string[]).includes(value);
}

export const CAPABILITY_INTERFACE_TYPES = ['openapi', 'graphql', 'grpc', 'custom'] as const;
export type CapabilityInterfaceType = (typeof CAPABILITY_INTERFACE_TYPES)[number];

export const CAPABILITY_AUTH_TYPES = ['api_key', 'oauth', 'jwt', 'signature'] as const;
export type CapabilityAuthType = (typeof CAPABILITY_AUTH_TYPES)[number];

export interface AuthMethod {
  type: CapabilityAuthType;
  apiKey?: {
    header?: string;
    query?: string;
    prefix?: string;
  };
  oauth?: {
    tokenUrl: string;
    scopes: string[];
  };
  jwt?: {
    issuer: string;
    algorithm: string;
  };
  signature?: {
    algorithm: string;
    publicKey: string;
  };
}

export interface CapabilityInterface {
  type: CapabilityInterfaceType;
  openapi?: {
    spec: string;
    baseUrl: string;
    authentication: AuthMethod;
  };
  graphql?: {
    schema: string;
    endpoint: string;
    authentication: AuthMethod;
  };
  grpc?: {
    protoFile: string;
    endpoint: string;
    authentication: AuthMethod;
  };
  custom?: {
    protocol: string;
    specification: string;
    endpoint: string;
  };
}

export interface RateLimit {
  requests: number;
  period: number;
  burst?: number;
}

export interface QuotaLimit {
  name: string;
  resource: string;
  limit: number;
  period?: number;
}

export interface CapabilityAccess {
  endpoint: string;
  authentication: AuthMethod;
  sandbox?: {
    endpoint: string;
    limitations: string[];
  };
  sdks?: Array<{
    language: string;
    packageName: string;
    documentation: string;
  }>;
}

export interface ServiceLevelAgreement {
  availability: {
    target: number;
    measurementPeriod: 'daily' | 'weekly' | 'monthly';
  };
  responseTime: {
    p50Target: number;
    p95Target: number;
    p99Target: number;
  };
  support: {
    responseTime: number;
    channels: Array<'ticket' | 'chat' | 'email'>;
  };
  compensation: {
    type: 'credit' | 'refund';
    tiers: Array<{
      availabilityThreshold: number;
      compensationPercentage: number;
    }>;
  };
}

export interface CapabilityMarketData {
  [key: string]: unknown;
  capabilityType: CapabilityType;
  capability: {
    name: string;
    version: string;
    interface: CapabilityInterface;
    documentation?: string;
    examples?: Record<string, unknown>[];
    limitations?: string[];
  };
  performance?: Record<string, unknown>;
  quota: {
    type: 'unlimited' | 'limited' | 'tiered';
    limits?: QuotaLimit[];
    rateLimits: RateLimit[];
  };
  access: CapabilityAccess;
  sla?: ServiceLevelAgreement;
}

export interface CapabilityListing extends MarketListing {
  marketType: 'capability';
  marketData: CapabilityMarketData;
}

export type CapabilityListingPublishEventParams =
  Omit<MarketListingPublishEventParams, 'marketType' | 'marketData'> & {
    marketData: CapabilityMarketData;
  };

function requireNonEmpty(value: string, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`${field} must contain strings`);
    }
    const trimmed = entry.trim();
    if (trimmed.length) {
      result.push(trimmed);
    }
  }
  return result;
}

function parseAuthMethod(value: unknown, field: string): AuthMethod {
  const record = assertRecord(value, field);
  const typeValue = String(record.type ?? '');
  if (!CAPABILITY_AUTH_TYPES.includes(typeValue as CapabilityAuthType)) {
    throw new Error(`${field}.type is invalid`);
  }

  const auth: AuthMethod = { type: typeValue as CapabilityAuthType };

  if (typeValue === 'api_key' && record.apiKey !== undefined) {
    auth.apiKey = assertRecord(record.apiKey, `${field}.apiKey`) as AuthMethod['apiKey'];
  }
  if (typeValue === 'oauth' && record.oauth !== undefined) {
    const oauth = assertRecord(record.oauth, `${field}.oauth`);
    const tokenUrl = requireNonEmpty(String(oauth.tokenUrl ?? ''), `${field}.oauth.tokenUrl`);
    const scopes = parseStringArray(oauth.scopes ?? [], `${field}.oauth.scopes`);
    auth.oauth = { tokenUrl, scopes };
  }
  if (typeValue === 'jwt' && record.jwt !== undefined) {
    const jwt = assertRecord(record.jwt, `${field}.jwt`);
    const issuer = requireNonEmpty(String(jwt.issuer ?? ''), `${field}.jwt.issuer`);
    const algorithm = requireNonEmpty(String(jwt.algorithm ?? ''), `${field}.jwt.algorithm`);
    auth.jwt = { issuer, algorithm };
  }
  if (typeValue === 'signature' && record.signature !== undefined) {
    const signature = assertRecord(record.signature, `${field}.signature`);
    const algorithm = requireNonEmpty(String(signature.algorithm ?? ''), `${field}.signature.algorithm`);
    const publicKey = requireNonEmpty(String(signature.publicKey ?? ''), `${field}.signature.publicKey`);
    auth.signature = { algorithm, publicKey };
  }

  return auth;
}

function parseCapabilityInterface(value: unknown): CapabilityInterface {
  const record = assertRecord(value, 'capability.interface');
  const typeValue = String(record.type ?? '');
  if (!CAPABILITY_INTERFACE_TYPES.includes(typeValue as CapabilityInterfaceType)) {
    throw new Error('capability.interface.type is invalid');
  }

  const parsed: CapabilityInterface = { type: typeValue as CapabilityInterfaceType };

  if (typeValue === 'openapi') {
    const openapi = assertRecord(record.openapi, 'capability.interface.openapi');
    parsed.openapi = {
      spec: requireNonEmpty(String(openapi.spec ?? ''), 'capability.interface.openapi.spec'),
      baseUrl: requireNonEmpty(String(openapi.baseUrl ?? ''), 'capability.interface.openapi.baseUrl'),
      authentication: parseAuthMethod(openapi.authentication, 'capability.interface.openapi.authentication'),
    };
  }

  if (typeValue === 'graphql') {
    const graphql = assertRecord(record.graphql, 'capability.interface.graphql');
    parsed.graphql = {
      schema: requireNonEmpty(String(graphql.schema ?? ''), 'capability.interface.graphql.schema'),
      endpoint: requireNonEmpty(String(graphql.endpoint ?? ''), 'capability.interface.graphql.endpoint'),
      authentication: parseAuthMethod(graphql.authentication, 'capability.interface.graphql.authentication'),
    };
  }

  if (typeValue === 'grpc') {
    const grpc = assertRecord(record.grpc, 'capability.interface.grpc');
    parsed.grpc = {
      protoFile: requireNonEmpty(String(grpc.protoFile ?? ''), 'capability.interface.grpc.protoFile'),
      endpoint: requireNonEmpty(String(grpc.endpoint ?? ''), 'capability.interface.grpc.endpoint'),
      authentication: parseAuthMethod(grpc.authentication, 'capability.interface.grpc.authentication'),
    };
  }

  if (typeValue === 'custom') {
    const custom = assertRecord(record.custom, 'capability.interface.custom');
    parsed.custom = {
      protocol: requireNonEmpty(String(custom.protocol ?? ''), 'capability.interface.custom.protocol'),
      specification: requireNonEmpty(
        String(custom.specification ?? ''),
        'capability.interface.custom.specification',
      ),
      endpoint: requireNonEmpty(String(custom.endpoint ?? ''), 'capability.interface.custom.endpoint'),
    };
  }

  return parsed;
}

function parseRateLimits(value: unknown): RateLimit[] {
  if (!Array.isArray(value)) {
    throw new Error('quota.rateLimits must be an array');
  }
  return value.map((entry, index) => {
    const record = assertRecord(entry, `quota.rateLimits[${index}]`);
    const requests = Number(record.requests ?? NaN);
    const period = Number(record.period ?? NaN);
    if (!Number.isFinite(requests)) {
      throw new Error(`quota.rateLimits[${index}].requests must be a number`);
    }
    if (!Number.isFinite(period)) {
      throw new Error(`quota.rateLimits[${index}].period must be a number`);
    }
    const burst = record.burst;
    if (burst !== undefined && typeof burst !== 'number') {
      throw new Error(`quota.rateLimits[${index}].burst must be a number`);
    }
    return {
      requests,
      period,
      burst: typeof burst === 'number' ? burst : undefined,
    };
  });
}

function parseQuota(value: unknown): CapabilityMarketData['quota'] {
  const record = assertRecord(value, 'quota');
  const typeValue = String(record.type ?? '');
  if (!['unlimited', 'limited', 'tiered'].includes(typeValue)) {
    throw new Error('quota.type is invalid');
  }
  const rateLimits = parseRateLimits(record.rateLimits);

  let limits: QuotaLimit[] | undefined;
  if (record.limits !== undefined) {
    if (!Array.isArray(record.limits)) {
      throw new Error('quota.limits must be an array');
    }
    limits = record.limits.map((entry, index) => {
      const limit = assertRecord(entry, `quota.limits[${index}]`);
      const name = requireNonEmpty(String(limit.name ?? ''), `quota.limits[${index}].name`);
      const resource = requireNonEmpty(
        String(limit.resource ?? ''),
        `quota.limits[${index}].resource`,
      );
      const amount = Number(limit.limit ?? NaN);
      if (!Number.isFinite(amount)) {
        throw new Error(`quota.limits[${index}].limit must be a number`);
      }
      const period = limit.period;
      if (period !== undefined && typeof period !== 'number') {
        throw new Error(`quota.limits[${index}].period must be a number`);
      }
      return {
        name,
        resource,
        limit: amount,
        period: typeof period === 'number' ? period : undefined,
      };
    });
  }

  return {
    type: typeValue as CapabilityMarketData['quota']['type'],
    limits,
    rateLimits,
  };
}

function parseAccess(value: unknown): CapabilityAccess {
  const record = assertRecord(value, 'access');
  const endpoint = requireNonEmpty(String(record.endpoint ?? ''), 'access.endpoint');
  const authentication = parseAuthMethod(record.authentication, 'access.authentication');

  let sandbox: CapabilityAccess['sandbox'];
  if (record.sandbox !== undefined) {
    const sandboxRecord = assertRecord(record.sandbox, 'access.sandbox');
    sandbox = {
      endpoint: requireNonEmpty(String(sandboxRecord.endpoint ?? ''), 'access.sandbox.endpoint'),
      limitations: parseStringArray(sandboxRecord.limitations ?? [], 'access.sandbox.limitations'),
    };
  }

  let sdks: CapabilityAccess['sdks'];
  if (record.sdks !== undefined) {
    if (!Array.isArray(record.sdks)) {
      throw new Error('access.sdks must be an array');
    }
    sdks = record.sdks.map((entry, index) => {
      const sdk = assertRecord(entry, `access.sdks[${index}]`);
      const language = requireNonEmpty(String(sdk.language ?? ''), `access.sdks[${index}].language`);
      const packageName = requireNonEmpty(
        String(sdk.packageName ?? ''),
        `access.sdks[${index}].packageName`,
      );
      const documentation = requireNonEmpty(
        String(sdk.documentation ?? ''),
        `access.sdks[${index}].documentation`,
      );
      return { language, packageName, documentation };
    });
  }

  return {
    endpoint,
    authentication,
    sandbox,
    sdks,
  };
}

export function parseCapabilityMarketData(value: unknown): CapabilityMarketData {
  const record = assertRecord(value, 'marketData');
  const typeValue = String(record.capabilityType ?? '');
  if (!isCapabilityType(typeValue)) {
    throw new Error('capabilityType is invalid');
  }

  const capability = assertRecord(record.capability, 'capability');
  const name = requireNonEmpty(String(capability.name ?? ''), 'capability.name');
  const version = requireNonEmpty(String(capability.version ?? ''), 'capability.version');
  const capabilityInterface = parseCapabilityInterface(capability.interface);

  const access = parseAccess(record.access);
  const quota = parseQuota(record.quota);

  return {
    capabilityType: typeValue,
    capability: {
      name,
      version,
      interface: capabilityInterface,
      documentation: typeof capability.documentation === 'string' ? capability.documentation : undefined,
      examples: Array.isArray(capability.examples)
        ? (capability.examples as Record<string, unknown>[])
        : undefined,
      limitations: Array.isArray(capability.limitations)
        ? parseStringArray(capability.limitations, 'capability.limitations')
        : undefined,
    },
    performance: record.performance as Record<string, unknown> | undefined,
    quota,
    access,
    sla: record.sla as ServiceLevelAgreement | undefined,
  };
}

export async function createCapabilityListingPublishEnvelope(
  params: CapabilityListingPublishEventParams,
): Promise<EventEnvelope> {
  const marketData = parseCapabilityMarketData(params.marketData);
  return createMarketListingPublishEnvelope({
    ...params,
    marketType: 'capability',
    marketData,
  });
}
