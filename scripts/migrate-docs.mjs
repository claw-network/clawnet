/**
 * Migrate existing docs/ markdown files into Fumadocs content/docs/ as MDX.
 * Run: node scripts/migrate-docs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
const CONTENT = join(ROOT, 'packages', 'docs', 'content', 'docs');

/** Mapping: { targetPath: { source, title, description } } */
const pages = [
  // Index page
  {
    target: 'index.mdx',
    source: null,
    title: 'ClawNet Documentation',
    description: 'Economic infrastructure for autonomous AI agents',
    body: `## Welcome to ClawNet

ClawNet is the economic infrastructure protocol for 150M+ autonomous AI agents. It provides decentralized identity, wallets, marketplaces, service contracts, reputation systems, and DAO governance — enabling agents to own assets, trade value, and participate in governance.

### Quick Navigation

- **[Getting Started](/docs/getting-started/introduction)** — Vision, architecture, and quickstart guide
- **[Core Modules](/docs/core-modules/identity)** — Identity, Wallet, Markets, Contracts, Reputation, DAO
- **[Developer Guide](/docs/developer-guide/agent-runtime)** — Agent runtime, SDK, API reference
- **[Business & Economics](/docs/business-economics/agent-business)** — Agent business framework, economics, analysis
- **[Implementation Specs](/docs/implementation-specs/overview)** — Protocol, crypto, P2P, storage specifications
- **[Implementation Tasks](/docs/implementation-tasks/mvp-task-list)** — MVP task list, sprint plan, acceptance criteria
- **[Event Schemas](/docs/event-schemas/overview)** — Identity, wallet, markets, contracts, reputation event schemas
`,
  },

  // Getting Started
  { target: 'getting-started/introduction.mdx', source: 'VISION.md', title: 'Introduction & Vision', description: 'ClawNet vision — economic infrastructure for 150M+ autonomous AI agents' },
  { target: 'getting-started/architecture.mdx', source: 'ARCHITECTURE.md', title: 'Architecture Overview', description: 'Layered protocol architecture: application, SDK, and protocol modules' },
  { target: 'getting-started/quick-start.mdx', source: 'QUICKSTART.md', title: 'Quick Start', description: 'Get a ClawNet node running in under 5 minutes' },
  { target: 'getting-started/deployment.mdx', source: 'DEPLOYMENT.md', title: 'Deployment Guide', description: 'Deploy ClawNet nodes for development, staging, and production' },
  { target: 'getting-started/faq.mdx', source: 'FAQ.md', title: 'FAQ', description: 'Frequently asked questions about ClawNet' },

  // Core Modules
  { target: 'core-modules/identity.mdx', source: 'IDENTITY.md', title: 'Identity System', description: 'Decentralized identity (DID) system for AI agents' },
  { target: 'core-modules/wallet.mdx', source: 'WALLET.md', title: 'Wallet System', description: 'AI agent wallet — asset management, transfers, escrow, key management' },
  { target: 'core-modules/markets.mdx', source: 'MARKETS.md', title: 'Markets', description: 'Info Market, Task Market, and Capability Market design' },
  { target: 'core-modules/markets-advanced.mdx', source: 'MARKETS_ADVANCED.md', title: 'Markets Advanced', description: 'Deep-dive into market implementation: pricing, matching, payment' },
  { target: 'core-modules/service-contracts.mdx', source: 'SERVICE_CONTRACTS.md', title: 'Service Contracts', description: 'Service contract lifecycle: negotiation, signing, execution, settlement' },
  { target: 'core-modules/smart-contracts.mdx', source: 'SMART_CONTRACTS.md', title: 'Smart Contracts', description: 'Multi-party, chained, conditional, and composite contract systems' },
  { target: 'core-modules/reputation.mdx', source: 'REPUTATION.md', title: 'Reputation System', description: 'Multi-dimensional reputation scoring with 7 tiers' },
  { target: 'core-modules/dao.mdx', source: 'DAO.md', title: 'DAO Governance', description: 'Decentralized governance: proposals, voting, timelock execution' },

  // Developer Guide
  { target: 'developer-guide/agent-runtime.mdx', source: 'AGENT_RUNTIME.md', title: 'Agent Runtime', description: 'How AI agents run as ClawNet nodes (P2P: 9527, API: 9528)' },
  { target: 'developer-guide/sdk-guide.mdx', source: 'SDK_GUIDE.md', title: 'SDK Guide', description: 'TypeScript and Python SDK usage guide' },
  { target: 'developer-guide/api-reference.mdx', source: 'API_REFERENCE.md', title: 'API Reference', description: 'REST API reference for the clawnetd daemon' },
  { target: 'developer-guide/api-errors.mdx', source: 'implementation/tasks/api-errors.md', title: 'API Error Codes', description: 'Comprehensive error code catalog by domain' },
  { target: 'developer-guide/openclaw-integration.mdx', source: 'OPENCLAW_INTEGRATION.md', title: 'OpenClaw Integration', description: 'Connect OpenClaw agents to ClawNet network' },
  { target: 'developer-guide/api-design-draft.mdx', source: 'implementation/tasks/min-api-draft.md', title: 'API Design Draft', description: 'Minimal API design aligned with OpenAPI spec' },

  // Business & Economics
  { target: 'business-economics/agent-business.mdx', source: 'AGENT_BUSINESS.md', title: 'Agent Business Framework', description: 'Framework for AI agents to create and operate businesses' },
  { target: 'business-economics/economics.mdx', source: 'implementation/economics.md', title: 'Economics & Incentives', description: 'Fee model, escrow fees, transaction fees, DAO treasury, node incentives' },
  { target: 'business-economics/moltbook-analysis.mdx', source: 'MOLTBOOK_ANALYSIS.md', title: 'Moltbook Analysis', description: 'Analysis of 1.5M+ AI agents on Moltbook social platform' },
  { target: 'business-economics/decentralization.mdx', source: 'DECENTRALIZATION.md', title: 'Decentralization Roadmap', description: 'Four-phase decentralization plan from bootstrap to full self-governance' },

  // Implementation Specs
  { target: 'implementation-specs/overview.mdx', source: 'IMPLEMENTATION.md', title: 'Implementation Overview', description: 'Master implementation guide and specification index' },
  { target: 'implementation-specs/protocol-spec.mdx', source: 'implementation/protocol-spec.md', title: 'Protocol Specification', description: 'Event-sourced system model, core data types, event envelope structure' },
  { target: 'implementation-specs/crypto-spec.mdx', source: 'implementation/crypto-spec.md', title: 'Crypto Specification', description: 'Ed25519, X25519, SHA-256, AES-256-GCM, Argon2id cryptographic primitives' },
  { target: 'implementation-specs/p2p-spec.mdx', source: 'implementation/p2p-spec.md', title: 'P2P Specification', description: 'libp2p networking, Gossipsub, FlatBuffers encoding' },
  { target: 'implementation-specs/storage-spec.mdx', source: 'implementation/storage-spec.md', title: 'Storage Specification', description: 'LevelDB storage, event log, KV indexes, snapshot strategy' },
  { target: 'implementation-specs/security.mdx', source: 'implementation/security.md', title: 'Security & Threat Model', description: 'Seven threat categories with mitigations, audit plan, incident response' },
  { target: 'implementation-specs/testing-plan.mdx', source: 'implementation/testing-plan.md', title: 'Testing Plan', description: 'Five-tier testing strategy with exit criteria' },
  { target: 'implementation-specs/rollout.mdx', source: 'implementation/rollout.md', title: 'Rollout Plan', description: 'Alpha → Beta/Testnet → Mainnet three-phase release' },
  { target: 'implementation-specs/open-questions.mdx', source: 'implementation/open-questions.md', title: 'Open Questions', description: 'Architecture decisions and their resolutions' },
  { target: 'implementation-specs/spec-freeze.mdx', source: 'implementation/SPEC_FREEZE.md', title: 'Spec Freeze', description: 'v1.0.0-mvp specification freeze declaration' },

  // Implementation Tasks
  { target: 'implementation-tasks/mvp-task-list.mdx', source: 'implementation/tasks/mvp-task-list.md', title: 'MVP Task List', description: 'Module-by-module executable task breakdown for MVP' },
  { target: 'implementation-tasks/sprint-plan.mdx', source: 'implementation/tasks/mvp-sprint-plan.md', title: 'Sprint Plan', description: 'Week-by-week sprint plan (Sprint 0–7) for MVP delivery' },
  { target: 'implementation-tasks/acceptance-checklist.mdx', source: 'implementation/tasks/acceptance-checklist.md', title: 'Acceptance Checklist', description: 'MVP acceptance criteria organized by module' },

  // Event Schemas
  { target: 'event-schemas/overview.mdx', source: 'implementation/event-schemas/README.md', title: 'Event Schemas Overview', description: 'Index of field-level event schema definitions' },
  { target: 'event-schemas/identity-events.mdx', source: 'implementation/event-schemas/identity.md', title: 'Identity Events', description: 'identity.create, update, platform.link, capability.register events' },
  { target: 'event-schemas/wallet-events.mdx', source: 'implementation/event-schemas/wallet.md', title: 'Wallet Events', description: 'wallet.transfer, escrow state machine events' },
  { target: 'event-schemas/markets-events.mdx', source: 'implementation/event-schemas/markets.md', title: 'Markets Events', description: 'Listing, order, bid, dispute, subscription event schemas' },
  { target: 'event-schemas/contracts-events.mdx', source: 'implementation/event-schemas/contracts.md', title: 'Contract Events', description: 'Contract lifecycle: create, sign, activate, milestone, dispute, complete' },
  { target: 'event-schemas/reputation-events.mdx', source: 'implementation/event-schemas/reputation.md', title: 'Reputation Events', description: 'reputation.record event schema' },
  { target: 'event-schemas/changelog.mdx', source: 'implementation/event-schemas/CHANGELOG.md', title: 'Event Schema Changelog', description: 'Version history for event schemas' },
];

function extractFirstHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function stripFirstHeading(content) {
  // Remove the first # heading line (and any blank lines immediately after)
  return content.replace(/^#\s+.+\n\n?/, '');
}

let created = 0;
let errors = 0;

for (const page of pages) {
  const targetPath = join(CONTENT, page.target);
  const dir = dirname(targetPath);

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let bodyContent = '';

  if (page.body) {
    // Static body content
    bodyContent = page.body;
  } else if (page.source) {
    // Read from source file
    const srcPath = join(DOCS, page.source);
    try {
      const raw = readFileSync(srcPath, 'utf-8');
      // Strip the first heading (will use frontmatter title instead)
      bodyContent = stripFirstHeading(raw);
    } catch (err) {
      console.error(`ERROR: Cannot read ${srcPath}: ${err.message}`);
      errors++;
      bodyContent = `> Source file: \`docs/${page.source}\`\n\nContent pending migration.`;
    }
  }

  // Build MDX content with frontmatter
  const mdx = `---
title: "${page.title}"
description: "${page.description}"
---

${bodyContent.trim()}
`;

  writeFileSync(targetPath, mdx, 'utf-8');
  created++;
  console.log(`✓ ${page.target}`);
}

console.log(`\nDone: ${created} files created, ${errors} errors.`);
