import { describe, expect, it } from 'vitest';
import { P2PNode } from '../src/p2p/node.js';
import { TOPIC_EVENTS } from '../src/p2p/topics.js';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPeers(node: P2PNode, minPeers = 1, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (node.getPeers().length >= minPeers) {
      return;
    }
    await delay(200);
  }
  throw new Error('timed out waiting for peers');
}

describe('p2p node', () => {
  it('publishes and receives gossip messages', async () => {
    const nodeA = new P2PNode({
      listen: ['/ip4/127.0.0.1/tcp/0'],
      bootstrap: [],
      enableDHT: false,
    });
    const nodeB = new P2PNode({
      listen: ['/ip4/127.0.0.1/tcp/0'],
      bootstrap: [],
      enableDHT: false,
    });

    await nodeA.start();
    await nodeB.start();

    await nodeB.subscribe(TOPIC_EVENTS, () => {});
    await nodeA.subscribe(TOPIC_EVENTS, () => {});

    const addresses = nodeB.getMultiaddrs();
    expect(addresses.length).toBeGreaterThan(0);
    await nodeA.connect(addresses[0]);

    await waitForPeers(nodeA, 1, 5000);
    await waitForPeers(nodeB, 1, 5000);

    expect(nodeA.getPeers().length).toBeGreaterThan(0);
    expect(nodeB.getPeers().length).toBeGreaterThan(0);

    await nodeA.stop();
    await nodeB.stop();
  }, 20000);
});
