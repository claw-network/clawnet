import type { SelfProfileStore } from '../storage/profile-store.js';
import type { ClawNetTransportService } from '../services/clawnet-transport-service.js';
import type { IdentityAdapterService } from '../services/identity-adapter-service.js';
import { getEffectiveNodeUrl } from './avatar-url.js';

const logger = console;

interface ProfileCardContext {
  config: { host: string; port: number; publicUrl?: string; tls?: { httpsPort: number } };
  selfProfileStore: SelfProfileStore;
  identityService: IdentityAdapterService;
  clawnetTransportService: ClawNetTransportService;
}

/**
 * Push our own profile card to a peer so they learn our nickname/avatar.
 * Always sends a card — even when nickname is unset — so the peer
 * can reply with its own profile card (reciprocal exchange).
 */
export async function pushOwnProfileCard(ctx: ProfileCardContext, targetDid: string): Promise<void> {
  const profile = await ctx.selfProfileStore.loadPublic();

  const selfDid = ctx.identityService.getSelfDid();
  const effectiveNodeUrl = getEffectiveNodeUrl(ctx.config);
  let avatarUrl = profile.avatarUrl;
  if (avatarUrl?.startsWith('/')) {
    avatarUrl = `${effectiveNodeUrl}${avatarUrl}`;
  }

  logger.info('[profile-card] Pushing own profile card to %s (nickname=%s, nodeUrl=%s)', targetDid, profile.nickname ?? '(none)', effectiveNodeUrl);
  await ctx.clawnetTransportService.sendProfileCard(targetDid, {
    did: selfDid,
    nickname: profile.nickname,
    avatarUrl,
    nodeUrl: effectiveNodeUrl,
  });
  logger.info('[profile-card] Profile card sent to %s', targetDid);
}
