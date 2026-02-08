import { MarketState } from './state.js';
import {
  MarketListing,
  MarketType,
  ListingStatus,
  ListingVisibility,
  PricingModel,
  TokenAmount,
} from './types.js';

export type SearchTokenAmountLike = TokenAmount | number | bigint;

export interface SearchQuery {
  keyword?: string;
  markets?: MarketType[];
  category?: string;
  tags?: string[];
  priceRange?: {
    min?: SearchTokenAmountLike;
    max?: SearchTokenAmountLike;
  };
  minReputation?: number;
  minRating?: number;
  skills?: string[];
  capabilityType?: string;
  infoTypes?: string[];
  contentFormats?: string[];
  accessMethods?: string[];
  statuses?: ListingStatus[];
  visibility?: ListingVisibility[];
  sort?: SortOption;
  page?: number;
  pageSize?: number;
  includeFacets?: boolean;
}

export type SortOption =
  | 'relevance'
  | 'newest'
  | 'price_asc'
  | 'price_desc'
  | 'rating'
  | 'popular'
  | 'reputation';

export interface FacetBucket {
  key: string;
  count: number;
}

export interface SearchResult {
  listings: (MarketListing & {
    score?: number;
  })[];
  facets?: {
    categories?: FacetBucket[];
    markets?: FacetBucket[];
    ratings?: FacetBucket[];
  };
  total: number;
  page: number;
  pageSize: number;
}

function normalizeTokenAmount(value: SearchTokenAmountLike): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error('token amount must be an integer');
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      throw new Error('token amount is required');
    }
    return BigInt(value);
  }
  throw new Error('token amount is required');
}

function tokenizeText(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!tokens) {
    return [];
  }
  return tokens.filter((token) => token.length > 0);
}

function addToIndex(index: Map<string, Set<string>>, key: string, id: string): void {
  const normalized = key.toLowerCase();
  const existing = index.get(normalized);
  if (existing) {
    existing.add(id);
  } else {
    index.set(normalized, new Set([id]));
  }
}

function removeFromIndex(index: Map<string, Set<string>>, key: string, id: string): void {
  const normalized = key.toLowerCase();
  const existing = index.get(normalized);
  if (!existing) {
    return;
  }
  existing.delete(id);
  if (existing.size === 0) {
    index.delete(normalized);
  }
}

function collectListingTokens(listing: MarketListing): Set<string> {
  const textParts: string[] = [
    listing.title,
    listing.description,
    listing.category,
    ...(listing.tags ?? []),
  ];

  const marketData = listing.marketData ?? {};
  if (listing.marketType === 'info') {
    const infoType = (marketData as Record<string, unknown>).infoType;
    if (typeof infoType === 'string') {
      textParts.push(infoType);
    }
    const content = (marketData as Record<string, unknown>).content;
    if (content && typeof content === 'object') {
      const format = (content as Record<string, unknown>).format;
      if (typeof format === 'string') {
        textParts.push(format);
      }
    }
  }
  if (listing.marketType === 'task') {
    const task = (marketData as Record<string, unknown>).task as
      | Record<string, unknown>
      | undefined;
    if (task) {
      const requirements = task.requirements;
      if (typeof requirements === 'string') {
        textParts.push(requirements);
      }
      const deliverables = task.deliverables;
      if (Array.isArray(deliverables)) {
        for (const entry of deliverables) {
          if (entry && typeof entry === 'object') {
            const name = (entry as Record<string, unknown>).name;
            if (typeof name === 'string') {
              textParts.push(name);
            }
          }
        }
      }
    }
  }

  if (listing.marketType === 'capability') {
    const capability = (marketData as Record<string, unknown>).capability as
      | Record<string, unknown>
      | undefined;
    if (capability) {
      const name = capability.name;
      if (typeof name === 'string') {
        textParts.push(name);
      }
      const documentation = capability.documentation;
      if (typeof documentation === 'string') {
        textParts.push(documentation);
      }
    }
  }

  const tokens = new Set<string>();
  for (const part of textParts) {
    for (const token of tokenizeText(String(part ?? ''))) {
      tokens.add(token);
    }
  }
  return tokens;
}

function extractSkills(listing: MarketListing): string[] {
  if (listing.marketType !== 'task') {
    return [];
  }
  const marketData = listing.marketData ?? {};
  const task = (marketData as Record<string, unknown>).task;
  if (!task || typeof task !== 'object') {
    return [];
  }
  const skills = (task as Record<string, unknown>).skills;
  if (!Array.isArray(skills)) {
    return [];
  }
  const result: string[] = [];
  for (const entry of skills) {
    if (typeof entry === 'string') {
      result.push(entry.toLowerCase());
    } else if (entry && typeof entry === 'object') {
      const name = (entry as Record<string, unknown>).name;
      if (typeof name === 'string') {
        result.push(name.toLowerCase());
      }
    }
  }
  return result;
}

function extractCapabilityType(listing: MarketListing): string | null {
  if (listing.marketType !== 'capability') {
    return null;
  }
  const marketData = listing.marketData ?? {};
  const direct = (marketData as Record<string, unknown>).capabilityType;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.toLowerCase();
  }
  const capability = (marketData as Record<string, unknown>).capability;
  if (capability && typeof capability === 'object') {
    const type = (capability as Record<string, unknown>).type;
    if (typeof type === 'string' && type.trim().length > 0) {
      return type.toLowerCase();
    }
  }
  return null;
}

function extractInfoType(listing: MarketListing): string | null {
  if (listing.marketType !== 'info') {
    return null;
  }
  const marketData = listing.marketData ?? {};
  const infoType = (marketData as Record<string, unknown>).infoType;
  if (typeof infoType === 'string' && infoType.trim().length > 0) {
    return infoType.toLowerCase();
  }
  return null;
}

function extractContentFormat(listing: MarketListing): string | null {
  if (listing.marketType !== 'info') {
    return null;
  }
  const marketData = listing.marketData ?? {};
  const content = (marketData as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') {
    return null;
  }
  const format = (content as Record<string, unknown>).format;
  if (typeof format === 'string' && format.trim().length > 0) {
    return format.toLowerCase();
  }
  return null;
}

function extractAccessMethodType(listing: MarketListing): string | null {
  if (listing.marketType !== 'info') {
    return null;
  }
  const marketData = listing.marketData ?? {};
  const accessMethod = (marketData as Record<string, unknown>).accessMethod;
  if (!accessMethod || typeof accessMethod !== 'object') {
    return null;
  }
  const type = (accessMethod as Record<string, unknown>).type;
  if (typeof type === 'string' && type.trim().length > 0) {
    return type.toLowerCase();
  }
  return null;
}

function extractPriceRange(pricing: PricingModel): { min: bigint; max: bigint } | null {
  switch (pricing.type) {
    case 'fixed': {
      if (!pricing.fixedPrice) {
        return null;
      }
      const value = normalizeTokenAmount(pricing.fixedPrice);
      return { min: value, max: value };
    }
    case 'range': {
      if (!pricing.priceRange) {
        return null;
      }
      const min = normalizeTokenAmount(pricing.priceRange.min);
      const max = normalizeTokenAmount(pricing.priceRange.max);
      return { min, max };
    }
    case 'subscription': {
      if (!pricing.subscriptionPrice) {
        return null;
      }
      const value = normalizeTokenAmount(pricing.subscriptionPrice.price);
      return { min: value, max: value };
    }
    case 'usage': {
      if (!pricing.usagePrice) {
        return null;
      }
      const value = normalizeTokenAmount(pricing.usagePrice.pricePerUnit);
      return { min: value, max: value };
    }
    case 'auction': {
      if (!pricing.auction) {
        return null;
      }
      const value = normalizeTokenAmount(pricing.auction.startingPrice);
      return { min: value, max: value };
    }
    default:
      return null;
  }
}

function clampPage(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export class MarketSearchIndex {
  private readonly listings = new Map<string, MarketListing>();
  private readonly tokensByListing = new Map<string, Set<string>>();
  private readonly tokenIndex = new Map<string, Set<string>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly categoryIndex = new Map<string, Set<string>>();
  private readonly marketIndex = new Map<MarketType, Set<string>>();
  private readonly skillIndex = new Map<string, Set<string>>();
  private readonly capabilityIndex = new Map<string, Set<string>>();
  private readonly infoTypeIndex = new Map<string, Set<string>>();
  private readonly contentFormatIndex = new Map<string, Set<string>>();
  private readonly accessMethodIndex = new Map<string, Set<string>>();
  private readonly skillByListing = new Map<string, string[]>();
  private readonly capabilityByListing = new Map<string, string | null>();
  private readonly infoTypeByListing = new Map<string, string | null>();
  private readonly contentFormatByListing = new Map<string, string | null>();
  private readonly accessMethodByListing = new Map<string, string | null>();

  static fromState(state: MarketState): MarketSearchIndex {
    const index = new MarketSearchIndex();
    for (const listing of Object.values(state.listings)) {
      index.indexListing(listing);
    }
    return index;
  }

  indexListing(listing: MarketListing): void {
    this.removeListing(listing.id);
    this.listings.set(listing.id, listing);

    const tokens = collectListingTokens(listing);
    this.tokensByListing.set(listing.id, tokens);
    for (const token of tokens) {
      addToIndex(this.tokenIndex, token, listing.id);
    }

    const tags = listing.tags ?? [];
    for (const tag of tags) {
      if (tag.trim().length > 0) {
        addToIndex(this.tagIndex, tag, listing.id);
      }
    }

    if (listing.category) {
      addToIndex(this.categoryIndex, listing.category, listing.id);
    }

    const marketSet = this.marketIndex.get(listing.marketType) ?? new Set();
    marketSet.add(listing.id);
    this.marketIndex.set(listing.marketType, marketSet);

    const skills = extractSkills(listing);
    this.skillByListing.set(listing.id, skills);
    for (const skill of skills) {
      addToIndex(this.skillIndex, skill, listing.id);
    }

    const capabilityType = extractCapabilityType(listing);
    this.capabilityByListing.set(listing.id, capabilityType);
    if (capabilityType) {
      addToIndex(this.capabilityIndex, capabilityType, listing.id);
    }

    const infoType = extractInfoType(listing);
    this.infoTypeByListing.set(listing.id, infoType);
    if (infoType) {
      addToIndex(this.infoTypeIndex, infoType, listing.id);
    }

    const contentFormat = extractContentFormat(listing);
    this.contentFormatByListing.set(listing.id, contentFormat);
    if (contentFormat) {
      addToIndex(this.contentFormatIndex, contentFormat, listing.id);
    }

    const accessMethod = extractAccessMethodType(listing);
    this.accessMethodByListing.set(listing.id, accessMethod);
    if (accessMethod) {
      addToIndex(this.accessMethodIndex, accessMethod, listing.id);
    }
  }

  removeListing(listingId: string): void {
    const listing = this.listings.get(listingId);
    if (!listing) {
      return;
    }

    const tokens = this.tokensByListing.get(listingId) ?? collectListingTokens(listing);
    for (const token of tokens) {
      removeFromIndex(this.tokenIndex, token, listingId);
    }
    this.tokensByListing.delete(listingId);

    for (const tag of listing.tags ?? []) {
      if (tag.trim().length > 0) {
        removeFromIndex(this.tagIndex, tag, listingId);
      }
    }

    if (listing.category) {
      removeFromIndex(this.categoryIndex, listing.category, listingId);
    }

    const marketSet = this.marketIndex.get(listing.marketType);
    if (marketSet) {
      marketSet.delete(listingId);
      if (marketSet.size === 0) {
        this.marketIndex.delete(listing.marketType);
      }
    }

    const skills = this.skillByListing.get(listingId) ?? extractSkills(listing);
    for (const skill of skills) {
      removeFromIndex(this.skillIndex, skill, listingId);
    }
    this.skillByListing.delete(listingId);

    const capabilityType = this.capabilityByListing.get(listingId) ?? extractCapabilityType(listing);
    if (capabilityType) {
      removeFromIndex(this.capabilityIndex, capabilityType, listingId);
    }
    this.capabilityByListing.delete(listingId);

    const infoType = this.infoTypeByListing.get(listingId) ?? extractInfoType(listing);
    if (infoType) {
      removeFromIndex(this.infoTypeIndex, infoType, listingId);
    }
    this.infoTypeByListing.delete(listingId);

    const contentFormat = this.contentFormatByListing.get(listingId) ?? extractContentFormat(listing);
    if (contentFormat) {
      removeFromIndex(this.contentFormatIndex, contentFormat, listingId);
    }
    this.contentFormatByListing.delete(listingId);

    const accessMethod = this.accessMethodByListing.get(listingId) ?? extractAccessMethodType(listing);
    if (accessMethod) {
      removeFromIndex(this.accessMethodIndex, accessMethod, listingId);
    }
    this.accessMethodByListing.delete(listingId);

    this.listings.delete(listingId);
  }

  search(query: SearchQuery): SearchResult {
    const page = clampPage(query.page ?? 1, 1, 1_000_000);
    const pageSize = clampPage(query.pageSize ?? 20, 1, 1000);

    const keywordTokens = query.keyword ? tokenizeText(query.keyword) : [];

    let candidateIds: Set<string> | null = null;

    if (keywordTokens.length > 0) {
      for (const token of keywordTokens) {
        const set = this.tokenIndex.get(token.toLowerCase());
        if (!set) {
          candidateIds = new Set();
          break;
        }
        if (!candidateIds) {
          candidateIds = new Set(set);
        } else {
          for (const id of [...candidateIds]) {
            if (!set.has(id)) {
              candidateIds.delete(id);
            }
          }
        }
      }
    }

    if (query.markets && query.markets.length > 0) {
      const marketCandidates = new Set<string>();
      for (const market of query.markets) {
        const set = this.marketIndex.get(market);
        if (set) {
          for (const id of set) {
            marketCandidates.add(id);
          }
        }
      }
      candidateIds = intersect(candidateIds, marketCandidates);
    }

    if (query.category) {
      const set = this.categoryIndex.get(query.category.toLowerCase()) ?? new Set();
      candidateIds = intersect(candidateIds, set);
    }

    if (query.tags && query.tags.length > 0) {
      const tagCandidates = new Set<string>();
      for (const tag of query.tags) {
        const set = this.tagIndex.get(tag.toLowerCase());
        if (set) {
          for (const id of set) {
            tagCandidates.add(id);
          }
        }
      }
      candidateIds = intersect(candidateIds, tagCandidates);
    }

    if (query.skills && query.skills.length > 0) {
      const skillCandidates = new Set<string>();
      for (const skill of query.skills) {
        const set = this.skillIndex.get(skill.toLowerCase());
        if (set) {
          for (const id of set) {
            skillCandidates.add(id);
          }
        }
      }
      candidateIds = intersect(candidateIds, skillCandidates);
    }

    if (query.capabilityType) {
      const set = this.capabilityIndex.get(query.capabilityType.toLowerCase()) ?? new Set();
      candidateIds = intersect(candidateIds, set);
    }

    if (query.infoTypes && query.infoTypes.length > 0) {
      const infoCandidates = new Set<string>();
      for (const infoType of query.infoTypes) {
        const set = this.infoTypeIndex.get(infoType.toLowerCase());
        if (set) {
          for (const id of set) {
            infoCandidates.add(id);
          }
        }
      }
      candidateIds = intersect(candidateIds, infoCandidates);
    }

    if (query.contentFormats && query.contentFormats.length > 0) {
      const formatCandidates = new Set<string>();
      for (const format of query.contentFormats) {
        const set = this.contentFormatIndex.get(format.toLowerCase());
        if (set) {
          for (const id of set) {
            formatCandidates.add(id);
          }
        }
      }
      candidateIds = intersect(candidateIds, formatCandidates);
    }

    if (query.accessMethods && query.accessMethods.length > 0) {
      const methodCandidates = new Set<string>();
      for (const method of query.accessMethods) {
        const set = this.accessMethodIndex.get(method.toLowerCase());
        if (set) {
          for (const id of set) {
            methodCandidates.add(id);
          }
        }
      }
      candidateIds = intersect(candidateIds, methodCandidates);
    }

    const ids = candidateIds ? [...candidateIds] : [...this.listings.keys()];

    const results: Array<MarketListing & { score?: number }> = [];
    for (const id of ids) {
      const listing = this.listings.get(id);
      if (!listing) {
        continue;
      }
      if (query.statuses && query.statuses.length > 0) {
        if (!query.statuses.includes(listing.status)) {
          continue;
        }
      }
      if (query.visibility && query.visibility.length > 0) {
        if (!query.visibility.includes(listing.visibility)) {
          continue;
        }
      }
      if (query.minReputation !== undefined && listing.seller.reputation < query.minReputation) {
        continue;
      }
      if (query.minRating !== undefined && listing.stats.averageRating < query.minRating) {
        continue;
      }
      if (query.priceRange) {
        const range = extractPriceRange(listing.pricing);
        if (!range) {
          continue;
        }
        if (query.priceRange.min !== undefined) {
          const min = normalizeTokenAmount(query.priceRange.min);
          if (range.max < min) {
            continue;
          }
        }
        if (query.priceRange.max !== undefined) {
          const max = normalizeTokenAmount(query.priceRange.max);
          if (range.min > max) {
            continue;
          }
        }
      }

      let score: number | undefined;
      if (keywordTokens.length > 0) {
        const tokenSet = this.tokensByListing.get(id) ?? collectListingTokens(listing);
        let matches = 0;
        for (const token of keywordTokens) {
          if (tokenSet.has(token.toLowerCase())) {
            matches += 1;
          }
        }
        score = matches;
      }

      results.push({ ...listing, score });
    }

    const total = results.length;
    const sorted = sortResults(results, query.sort, keywordTokens.length > 0);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageItems = sorted.slice(start, end);

    const response: SearchResult = {
      listings: pageItems,
      total,
      page,
      pageSize,
    };

    if (query.includeFacets) {
      response.facets = buildFacets(results);
    }

    return response;
  }
}

function sortResults(
  results: Array<MarketListing & { score?: number }>,
  sort: SortOption | undefined,
  hasKeyword: boolean,
): Array<MarketListing & { score?: number }> {
  const mode = sort ?? (hasKeyword ? 'relevance' : 'newest');
  const list = [...results];

  list.sort((a, b) => {
    switch (mode) {
      case 'relevance': {
        const scoreA = a.score ?? 0;
        const scoreB = b.score ?? 0;
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        return b.createdAt - a.createdAt;
      }
      case 'newest':
        return b.createdAt - a.createdAt;
      case 'price_asc':
        return comparePrice(a.pricing, b.pricing, true);
      case 'price_desc':
        return comparePrice(a.pricing, b.pricing, false);
      case 'rating':
        return b.stats.averageRating - a.stats.averageRating;
      case 'popular':
        return b.stats.orders - a.stats.orders;
      case 'reputation':
        return b.seller.reputation - a.seller.reputation;
      default:
        return 0;
    }
  });

  return list;
}

function comparePrice(a: PricingModel, b: PricingModel, asc: boolean): number {
  const rangeA = extractPriceRange(a);
  const rangeB = extractPriceRange(b);
  if (!rangeA && !rangeB) {
    return 0;
  }
  if (!rangeA) {
    return 1;
  }
  if (!rangeB) {
    return -1;
  }
  const diff = rangeA.min === rangeB.min ? 0 : rangeA.min < rangeB.min ? -1 : 1;
  return asc ? diff : -diff;
}

function buildFacets(results: Array<MarketListing & { score?: number }>): SearchResult['facets'] {
  const categoryCounts = new Map<string, number>();
  const marketCounts = new Map<string, number>();
  const ratingCounts = new Map<string, number>();

  for (const listing of results) {
    const categoryKey = listing.category;
    categoryCounts.set(categoryKey, (categoryCounts.get(categoryKey) ?? 0) + 1);
    const marketKey = listing.marketType;
    marketCounts.set(marketKey, (marketCounts.get(marketKey) ?? 0) + 1);

    const rating = listing.stats.averageRating;
    const bucket = rating >= 4.5
      ? '4.5+'
      : rating >= 4
        ? '4+'
        : rating >= 3
          ? '3+'
          : 'below';
    ratingCounts.set(bucket, (ratingCounts.get(bucket) ?? 0) + 1);
  }

  return {
    categories: [...categoryCounts.entries()].map(([key, count]) => ({ key, count })),
    markets: [...marketCounts.entries()].map(([key, count]) => ({ key, count })),
    ratings: [...ratingCounts.entries()].map(([key, count]) => ({ key, count })),
  };
}

function intersect(current: Set<string> | null, next: Set<string>): Set<string> {
  if (!current) {
    return new Set(next);
  }
  for (const id of [...current]) {
    if (!next.has(id)) {
      current.delete(id);
    }
  }
  return current;
}
