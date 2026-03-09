/**
 * Indexer barrel — re-exports for `@claw-network/node` internal use.
 */

export { IndexerStore } from './store.js';
export type {
  RawEvent,
  WalletTransfer,
  IndexedServiceContract,
  IndexedProposal,
  IndexedVote,
  IndexedReview,
  EscrowRecord,
  RelayRewardRecord,
} from './store.js';

export { EventIndexer } from './indexer.js';
export type { EventIndexerConfig } from './indexer.js';

export { IndexerQuery } from './query.js';
export type {
  PaginatedResult,
  PaginationOpts,
  TransferRow,
  TransferFilter,
  EscrowRow,
  EscrowFilter,
  ServiceContractRow,
  ServiceContractFilter,
  ProposalRow,
  ProposalFilter,
  VoteRow,
  VoteFilter,
  ReviewRow,
  ReviewFilter,
  DidCacheRow,
  EventRow,
  EventFilter,
  RelayRewardRow,
  RelayRewardFilter,
} from './query.js';
