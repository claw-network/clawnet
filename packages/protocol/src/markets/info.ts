import { EventEnvelope } from '@clawtoken/core/protocol';
import {
  createMarketListingPublishEnvelope,
  MarketListingPublishEventParams,
} from './events.js';
import { MarketListing } from './types.js';

export const INFO_TYPES = [
  'knowledge',
  'experience',
  'model',
  'template',
  'dataset',
  'api',
  'stream',
  'snapshot',
  'intelligence',
  'signal',
  'prediction',
  'alert',
  'analysis',
  'research',
  'insight',
  'consultation',
] as const;
export type InfoType = (typeof INFO_TYPES)[number];

export function isInfoType(value: string): value is InfoType {
  return (INFO_TYPES as readonly string[]).includes(value);
}

export const CONTENT_FORMATS = [
  'text',
  'json',
  'csv',
  'parquet',
  'binary',
  'image',
  'video',
  'audio',
  'mixed',
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export function isContentFormat(value: string): value is ContentFormat {
  return (CONTENT_FORMATS as readonly string[]).includes(value);
}

export const ACCESS_METHOD_TYPES = ['download', 'api', 'stream', 'query'] as const;
export type AccessMethodType = (typeof ACCESS_METHOD_TYPES)[number];

export function isAccessMethodType(value: string): value is AccessMethodType {
  return (ACCESS_METHOD_TYPES as readonly string[]).includes(value);
}

export interface InfoPreview {
  type: 'summary' | 'sample' | 'schema' | 'stats';
  content: string;
  truncated: boolean;
}

export interface InfoSample {
  description: string;
  data: string;
  percentage?: number;
}

export interface ContentSchema {
  name?: string;
  format?: string;
  version?: string;
}

export interface AccessMethod {
  type: AccessMethodType;
  download?: {
    formats: string[];
    maxDownloads?: number;
    expiresIn?: number;
  };
  api?: {
    endpoint: string;
    authentication: 'token' | 'signature';
    rateLimit?: {
      requests: number;
      period: number;
    };
    documentation?: string;
  };
  stream?: {
    protocol: 'websocket' | 'sse' | 'grpc';
    endpoint: string;
    frequency?: number;
  };
  query?: {
    language: 'sql' | 'graphql' | 'natural';
    endpoint: string;
    schema?: string;
  };
}

export type LicenseType =
  | 'exclusive'
  | 'non_exclusive'
  | 'limited'
  | 'perpetual'
  | 'subscription'
  | 'custom';

export interface InfoLicense {
  type: LicenseType;
  permissions: {
    use: boolean;
    modify: boolean;
    distribute: boolean;
    commercialize: boolean;
    sublicense: boolean;
  };
  restrictions: {
    attribution: boolean;
    shareAlike: boolean;
    nonCompete: boolean;
    confidential: boolean;
    termLimit?: number;
  };
  customTerms?: string;
}

export interface InfoQuality {
  accuracy?: number;
  freshness?: number;
  completeness?: number;
  source?: string;
  verifiedBy?: string[];
  lastUpdated?: number;
}

export interface UsageRestrictions {
  maxUses?: number;
  validityPeriod?: number;
  maxConcurrent?: number;
  derivativeWorks: boolean;
  resale: boolean;
  allowedPurposes?: string[];
  prohibitedPurposes?: string[];
}

export interface InfoContent {
  [key: string]: unknown;
  format: ContentFormat;
  size?: number;
  hash?: string;
  preview?: InfoPreview;
  sample?: InfoSample;
  schema?: ContentSchema;
}

export interface InfoMarketData {
  [key: string]: unknown;
  infoType: InfoType;
  content: InfoContent;
  quality?: InfoQuality;
  accessMethod: AccessMethod;
  license: InfoLicense;
  usageRestrictions?: UsageRestrictions;
}

export interface InfoListing extends MarketListing {
  marketType: 'info';
  marketData: InfoMarketData;
}

export type InfoListingPublishEventParams = Omit<MarketListingPublishEventParams, 'marketType' | 'marketData'> & {
  marketData: InfoMarketData;
};

export function parseInfoMarketData(value: unknown): InfoMarketData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('marketData must be an object');
  }
  const record = value as Record<string, unknown>;
  const infoTypeValue = String(record.infoType ?? '');
  if (!isInfoType(infoTypeValue)) {
    throw new Error('infoType is invalid');
  }
  const content = record.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error('content is required');
  }
  const contentRecord = content as Record<string, unknown>;
  const formatValue = String(contentRecord.format ?? '');
  if (!isContentFormat(formatValue)) {
    throw new Error('content.format is invalid');
  }
  if (contentRecord.hash !== undefined) {
    const hashValue = String(contentRecord.hash ?? '');
    if (!/^[0-9a-f]{64}$/i.test(hashValue)) {
      throw new Error('content.hash is invalid');
    }
  }
  const accessMethod = record.accessMethod;
  if (!accessMethod || typeof accessMethod !== 'object' || Array.isArray(accessMethod)) {
    throw new Error('accessMethod is required');
  }
  const accessType = String((accessMethod as Record<string, unknown>).type ?? '');
  if (!accessType || !isAccessMethodType(accessType)) {
    throw new Error('accessMethod.type is invalid');
  }
  const license = record.license;
  if (!license || typeof license !== 'object' || Array.isArray(license)) {
    throw new Error('license is required');
  }
  const licenseType = String((license as Record<string, unknown>).type ?? '');
  if (!licenseType || !['exclusive', 'non_exclusive', 'limited', 'perpetual', 'subscription', 'custom'].includes(licenseType)) {
    throw new Error('license.type is invalid');
  }
  const permissions = (license as Record<string, unknown>).permissions;
  const restrictions = (license as Record<string, unknown>).restrictions;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new Error('license.permissions is required');
  }
  if (!restrictions || typeof restrictions !== 'object' || Array.isArray(restrictions)) {
    throw new Error('license.restrictions is required');
  }
  const permissionRecord = permissions as Record<string, unknown>;
  const restrictionRecord = restrictions as Record<string, unknown>;
  const permissionFields = ['use', 'modify', 'distribute', 'commercialize', 'sublicense'];
  for (const field of permissionFields) {
    if (typeof permissionRecord[field] !== 'boolean') {
      throw new Error(`license.permissions.${field} must be a boolean`);
    }
  }
  const restrictionFields = ['attribution', 'shareAlike', 'nonCompete', 'confidential'];
  for (const field of restrictionFields) {
    if (typeof restrictionRecord[field] !== 'boolean') {
      throw new Error(`license.restrictions.${field} must be a boolean`);
    }
  }

  return {
    infoType: infoTypeValue,
    content: {
      ...(contentRecord as InfoContent),
      format: formatValue,
    },
    quality: record.quality as InfoQuality | undefined,
    accessMethod: accessMethod as AccessMethod,
    license: license as InfoLicense,
    usageRestrictions: record.usageRestrictions as UsageRestrictions | undefined,
  };
}

export async function createInfoListingPublishEnvelope(
  params: InfoListingPublishEventParams,
): Promise<EventEnvelope> {
  const marketData = parseInfoMarketData(params.marketData);
  return createMarketListingPublishEnvelope({
    ...params,
    marketType: 'info',
    marketData,
  });
}
