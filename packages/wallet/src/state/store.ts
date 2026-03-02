/**
 * Simple reactive state store for the wallet app.
 */

import { ApiClient } from '../api/client.js';

// ── Types ──

export interface ConnectionState {
  connected: boolean;
  baseUrl: string;
  apiKey: string;
  did: string;
  network: string;
  version: string;
}

export interface BalanceState {
  balance: number;
  available: number;
  pending: number;
  locked: number;
  loading: boolean;
}

export interface Transaction {
  txHash: string;
  from: string;
  to: string;
  amount: number;
  fee?: number;
  memo?: string;
  type: string;
  status: string;
  timestamp: number;
}

export interface HistoryState {
  transactions: Transaction[];
  total: number;
  hasMore: boolean;
  page: number;
  loading: boolean;
}

export interface AppState {
  route: 'connect' | 'dashboard' | 'transfer' | 'history' | 'escrow';
  connection: ConnectionState;
  balance: BalanceState;
  history: HistoryState;
}

// ── Initial state ──

function loadSavedConnection(): Partial<ConnectionState> {
  try {
    const saved = localStorage.getItem('clawnet_wallet_conn');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {};
}

const savedConn = loadSavedConnection();

const initialState: AppState = {
  route: savedConn.connected ? 'dashboard' : 'connect',
  connection: {
    connected: false,
    baseUrl: savedConn.baseUrl || 'http://127.0.0.1:9528',
    apiKey: savedConn.apiKey || '',
    did: '',
    network: '',
    version: '',
  },
  balance: {
    balance: 0,
    available: 0,
    pending: 0,
    locked: 0,
    loading: false,
  },
  history: {
    transactions: [],
    total: 0,
    hasMore: false,
    page: 1,
    loading: false,
  },
};

// ── Store ──

type Listener = () => void;

class Store {
  private state: AppState;
  private listeners: Set<Listener> = new Set();
  api: ApiClient;

  constructor() {
    this.state = { ...initialState };
    this.api = new ApiClient({
      baseUrl: this.state.connection.baseUrl,
      apiKey: this.state.connection.apiKey || undefined,
    });
  }

  getState(): Readonly<AppState> {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private update(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  // ── Route ──

  navigate(route: AppState['route']): void {
    this.update({ route });
  }

  // ── Connection ──

  async connect(baseUrl: string, apiKey: string): Promise<void> {
    this.api.updateConfig({ baseUrl, apiKey: apiKey || undefined });

    const status = await this.api.getNodeStatus();

    const connection: ConnectionState = {
      connected: true,
      baseUrl,
      apiKey,
      did: status.did,
      network: status.network,
      version: status.version,
    };

    localStorage.setItem('clawnet_wallet_conn', JSON.stringify({
      connected: true,
      baseUrl,
      apiKey,
    }));

    this.update({ connection, route: 'dashboard' });
  }

  disconnect(): void {
    localStorage.removeItem('clawnet_wallet_conn');
    this.state = {
      ...initialState,
      connection: {
        ...initialState.connection,
        connected: false,
      },
      route: 'connect',
    };
    this.emit();
  }

  // ── Balance ──

  async fetchBalance(): Promise<void> {
    const { did } = this.state.connection;
    if (!did) return;

    this.update({
      balance: { ...this.state.balance, loading: true },
    });

    try {
      const bal = await this.api.getBalance(did);
      this.update({
        balance: { ...bal, loading: false },
      });
    } catch {
      this.update({
        balance: { ...this.state.balance, loading: false },
      });
      throw new Error('Failed to fetch balance');
    }
  }

  // ── History ──

  async fetchHistory(page = 1): Promise<void> {
    const { did } = this.state.connection;
    if (!did) return;

    this.update({
      history: { ...this.state.history, loading: true, page },
    });

    try {
      const res = await this.api.getTransactions(did, { page, per_page: 15 });
      this.update({
        history: {
          transactions: res.transactions,
          total: res.total,
          hasMore: res.hasMore,
          page,
          loading: false,
        },
      });
    } catch {
      this.update({
        history: { ...this.state.history, loading: false },
      });
    }
  }

  // ── Transfer ──

  async sendTransfer(params: {
    to: string;
    amount: number;
    passphrase: string;
    memo?: string;
    fee?: number;
  }): Promise<{ txHash: string }> {
    const { did } = this.state.connection;
    if (!did) throw new Error('Not connected');

    const result = await this.api.transfer({
      did,
      passphrase: params.passphrase,
      nonce: Date.now(),
      to: params.to,
      amount: params.amount,
      fee: params.fee,
      memo: params.memo,
    });

    // Refresh balance after transfer
    this.fetchBalance().catch(() => {});

    return { txHash: result.txHash };
  }
}

export const store = new Store();
