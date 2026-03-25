import type { InterventionScope, OwnerPermissions } from '../protocol/index.js';

const ALLOWED_SCOPES: readonly InterventionScope[] = [
  'send_message',
  'manage_contacts',
  'manage_groups',
  'clawnet_transfer',
  'clawnet_escrow',
  'clawnet_market',
  'clawnet_reputation',
];

export interface OwnerPermissionServiceOptions {
  mode: 'observer' | 'intervener';
  interventionScopes: InterventionScope[];
  privateConversations: string[];
}

export class OwnerPermissionService {
  private readonly mode: 'observer' | 'intervener';
  private readonly interventionScopes: InterventionScope[];
  private readonly privateConversationSet: Set<string>;

  constructor(options: OwnerPermissionServiceOptions) {
    this.mode = options.mode;
    const dedupedScopes = new Set<InterventionScope>();
    for (const scope of options.interventionScopes) {
      if (ALLOWED_SCOPES.includes(scope)) {
        dedupedScopes.add(scope);
      }
    }
    this.interventionScopes = [...dedupedScopes];

    const normalizedPrivate = options.privateConversations
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    this.privateConversationSet = new Set(normalizedPrivate);
  }

  getPermissions(): OwnerPermissions {
    return {
      mode: this.mode,
      interventionScopes: [...this.interventionScopes],
      privateConversations: [...this.privateConversationSet],
    };
  }

  isPrivateConversation(conversationId: string): boolean {
    return this.privateConversationSet.has(conversationId);
  }

  listPrivateConversations(): string[] {
    return [...this.privateConversationSet];
  }

  canIntervene(scope: InterventionScope): boolean {
    return this.mode === 'intervener' && this.interventionScopes.includes(scope);
  }
}

export function parseOwnerMode(raw: string | undefined): 'observer' | 'intervener' {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized || normalized === 'observer') {
    return 'observer';
  }
  if (normalized === 'intervener') {
    return 'intervener';
  }
  throw new Error(`TELAGENT_OWNER_MODE must be observer or intervener, got: ${raw}`);
}

export function parseOwnerScopes(raw: string | undefined): InterventionScope[] {
  if (!raw || !raw.trim()) {
    return [];
  }

  const scopes: InterventionScope[] = [];
  for (const token of raw.split(',')) {
    const scope = token.trim() as InterventionScope;
    if (!scope) {
      continue;
    }
    if (!ALLOWED_SCOPES.includes(scope)) {
      throw new Error(`TELAGENT_OWNER_SCOPES contains unsupported scope: ${scope}`);
    }
    scopes.push(scope);
  }
  return scopes;
}

export function parsePrivateConversations(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) {
    return [];
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
