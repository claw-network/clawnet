import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  BOOTSTRAP_P2P_CONFIG,
  DEFAULT_P2P_CONFIG,
  BOOTSTRAP_MULTIADDR,
  BOOTSTRAP_HOST,
  BOOTSTRAP_PORT,
  resolveBootstrapMultiaddrs,
} from '../src/p2p/config.js';
import { DEFAULT_CONFIG } from '../src/storage/config.js';

describe('DEFAULT_CONFIG bootstrap', () => {
  it('includes non-empty bootstrap list by default', () => {
    expect(DEFAULT_CONFIG.p2p?.bootstrap).toBeDefined();
    expect(DEFAULT_CONFIG.p2p!.bootstrap!.length).toBeGreaterThan(0);
  });

  it('uses the same bootstrap multiaddr as DEFAULT_P2P_CONFIG', () => {
    expect(DEFAULT_CONFIG.p2p!.bootstrap).toEqual(DEFAULT_P2P_CONFIG.bootstrap);
  });

  it('contains the canonical BOOTSTRAP_MULTIADDR', () => {
    expect(DEFAULT_CONFIG.p2p!.bootstrap).toContain(BOOTSTRAP_MULTIADDR);
  });
});

describe('bootstrap fallback logic', () => {
  it('undefined bootstrap → DEFAULT_P2P_CONFIG.bootstrap', () => {
    const configBootstrap: string[] | undefined = undefined;

    // Replicate the fallback logic from ClawNetNode.startInternal()
    const resolved = configBootstrap ?? DEFAULT_P2P_CONFIG.bootstrap;

    expect(resolved).toEqual(DEFAULT_P2P_CONFIG.bootstrap);
    expect(resolved.length).toBeGreaterThan(0);
  });

  it('explicit empty array (--no-bootstrap) is respected', () => {
    const configBootstrap: string[] = [];  // from --no-bootstrap

    const resolved = configBootstrap ?? DEFAULT_P2P_CONFIG.bootstrap;

    expect(resolved).toEqual([]);
  });

  it('non-empty config bootstrap takes precedence', () => {
    const custom = ['/ip4/1.2.3.4/tcp/9527/p2p/QmTest'];

    const resolved = custom ?? DEFAULT_P2P_CONFIG.bootstrap;

    expect(resolved).toEqual(custom);
  });
});

describe('BOOTSTRAP_P2P_CONFIG', () => {
  it('disables floodPublish for amplification protection', () => {
    expect(BOOTSTRAP_P2P_CONFIG.floodPublish).toBe(false);
  });

  it('has higher maxConnections than default', () => {
    const defaultMax = DEFAULT_P2P_CONFIG.connectionManager?.maxConnections ?? 100;
    const bootstrapMax = BOOTSTRAP_P2P_CONFIG.connectionManager?.maxConnections ?? 100;
    expect(bootstrapMax).toBeGreaterThan(defaultMax);
  });

  it('has no bootstrap peers (bootstrap is the root)', () => {
    expect(BOOTSTRAP_P2P_CONFIG.bootstrap).toEqual([]);
  });

  it('has tighter yamux stream limits', () => {
    const defaultStreams = DEFAULT_P2P_CONFIG.yamuxMaxInboundStreams ?? 256;
    const bootstrapStreams = BOOTSTRAP_P2P_CONFIG.yamuxMaxInboundStreams ?? 256;
    expect(bootstrapStreams).toBeLessThanOrEqual(defaultStreams);
  });

  it('has higher mesh parameters for hub topology', () => {
    expect(BOOTSTRAP_P2P_CONFIG.meshD!).toBeGreaterThan(DEFAULT_P2P_CONFIG.meshD!);
    expect(BOOTSTRAP_P2P_CONFIG.meshDhi!).toBeGreaterThan(DEFAULT_P2P_CONFIG.meshDhi!);
  });
});

describe('BOOTSTRAP_MULTIADDR is PeerId-free base address', () => {
  it('contains the bootstrap host', () => {
    expect(BOOTSTRAP_MULTIADDR).toContain('clawnetd.com');
  });

  it('does NOT contain any hardcoded PeerId', () => {
    expect(BOOTSTRAP_MULTIADDR).not.toContain('/p2p/');
  });

  it('matches expected format /dns4/<host>/tcp/<port>', () => {
    expect(BOOTSTRAP_MULTIADDR).toBe(`/dns4/${BOOTSTRAP_HOST}/tcp/${BOOTSTRAP_PORT}`);
  });
});

describe('resolveBootstrapMultiaddrs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns multiaddr with live PeerId on success', async () => {
    const fakePeerId = '12D3KooWTestPeerId1234567890';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { peerId: fakePeerId } }), { status: 200 }),
    );

    const result = await resolveBootstrapMultiaddrs('https://example.com/api/v1/node');
    expect(result).toEqual([`/dns4/${BOOTSTRAP_HOST}/tcp/${BOOTSTRAP_PORT}/p2p/${fakePeerId}`]);
  });

  it('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    await expect(resolveBootstrapMultiaddrs('https://example.com/api/v1/node'))
      .rejects.toThrow('HTTP 404');
  });

  it('throws on missing peerId in response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );

    await expect(resolveBootstrapMultiaddrs('https://example.com/api/v1/node'))
      .rejects.toThrow('missing peerId');
  });

  it('throws on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal)?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    await expect(resolveBootstrapMultiaddrs('https://example.com/api/v1/node', 50))
      .rejects.toThrow('timed out');
  });
});
