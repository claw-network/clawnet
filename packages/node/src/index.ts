export interface NodeConfig {
  dataDir?: string;
}

export class ClawTokenNode {
  constructor(readonly config: NodeConfig = {}) {}

  async start(): Promise<void> {
    throw new Error('Not implemented: node runtime is not yet wired');
  }

  async stop(): Promise<void> {
    throw new Error('Not implemented: node runtime is not yet wired');
  }
}

export * from './p2p/sync.js';
