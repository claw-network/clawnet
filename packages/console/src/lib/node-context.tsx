import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

type Network = 'mainnet' | 'testnet' | 'devnet' | undefined;

interface NodeInfo {
  network: Network;
  version?: string;
  did?: string;
}

const NodeContext = createContext<NodeInfo>({ network: undefined });

export function NodeProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<NodeInfo>({ network: undefined });

  useEffect(() => {
    api
      .get<{ network?: string; version?: string; did?: string }>('/node')
      .then((data) => {
        setInfo({
          network: data.network as Network,
          version: data.version,
          did: data.did,
        });
      })
      .catch(() => {
        // node endpoint is public; if it fails, leave defaults
      });
  }, []);

  return <NodeContext.Provider value={info}>{children}</NodeContext.Provider>;
}

export function useNode() {
  return useContext(NodeContext);
}
