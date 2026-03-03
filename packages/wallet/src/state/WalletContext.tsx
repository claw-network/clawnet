import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { ApiClient } from '../api/client';

// ─── Types ──────────────────────────────────────────────────────

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
  error?: string;
}

export interface AppState {
  connection: ConnectionState;
  balance: BalanceState;
  history: HistoryState;
  /** true while auto-reconnect is in progress on page load */
  reconnecting: boolean;
}

// ─── Actions ────────────────────────────────────────────────────

type Action =
  | { type: 'CONNECTED'; payload: { did: string; network: string; version: string; baseUrl: string; apiKey: string } }
  | { type: 'DISCONNECTED' }
  | { type: 'RECONNECTING' }
  | { type: 'RECONNECT_FAILED' }
  | { type: 'BALANCE_LOADING' }
  | { type: 'BALANCE_LOADED'; payload: { balance: number; available: number; pending: number; locked: number } }
  | { type: 'BALANCE_ERROR' }
  | { type: 'HISTORY_LOADING'; payload: { page: number } }
  | { type: 'HISTORY_LOADED'; payload: { transactions: Transaction[]; total: number; hasMore: boolean; page: number } }
  | { type: 'HISTORY_ERROR' };

// ─── Initial state ──────────────────────────────────────────────

function loadSavedConnection(): Partial<ConnectionState> {
  try {
    const saved = localStorage.getItem('clawnet_wallet_conn');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {};
}

const savedConn = loadSavedConnection();

const initialState: AppState = {
  connection: {
    connected: false,
    baseUrl: savedConn.baseUrl || 'http://127.0.0.1:9528',
    apiKey: savedConn.apiKey || '',
    did: '',
    network: '',
    version: '',
  },
  balance: { balance: 0, available: 0, pending: 0, locked: 0, loading: false },
  history: { transactions: [], total: 0, hasMore: false, page: 1, loading: false },
  reconnecting: false,
};

// ─── Reducer ────────────────────────────────────────────────────

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CONNECTED':
      return {
        ...state,
        connection: {
          connected: true,
          baseUrl: action.payload.baseUrl,
          apiKey: action.payload.apiKey,
          did: action.payload.did,
          network: action.payload.network,
          version: action.payload.version,
        },
      };
    case 'DISCONNECTED':
      return {
        ...initialState,
        connection: { ...initialState.connection, connected: false },
        reconnecting: false,
      };
    case 'RECONNECTING':
      return { ...state, reconnecting: true };
    case 'RECONNECT_FAILED':
      return { ...state, reconnecting: false };
    case 'BALANCE_LOADING':
      return { ...state, balance: { ...state.balance, loading: true } };
    case 'BALANCE_LOADED':
      return { ...state, balance: { ...action.payload, loading: false } };
    case 'BALANCE_ERROR':
      return { ...state, balance: { ...state.balance, loading: false } };
    case 'HISTORY_LOADING':
      return { ...state, history: { ...state.history, loading: true, page: action.payload.page } };
    case 'HISTORY_LOADED':
      return { ...state, history: { ...action.payload, loading: false, error: undefined } };
    case 'HISTORY_ERROR':
      return { ...state, history: { ...state.history, loading: false, error: 'Failed to load transactions' } };
    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────

interface WalletContextValue {
  state: AppState;
  api: ApiClient;
  connect: (baseUrl: string, apiKey: string) => Promise<void>;
  disconnect: () => void;
  skipReconnect: () => void;
  fetchBalance: () => Promise<void>;
  fetchHistory: (page?: number) => Promise<void>;
  sendTransfer: (params: {
    to: string;
    amount: number;
    passphrase: string;
    memo?: string;
    fee?: number;
  }) => Promise<{ txHash: string }>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const apiRef = useRef(
    new ApiClient({ baseUrl: initialState.connection.baseUrl, apiKey: initialState.connection.apiKey || undefined }),
  );

  const skipReconnect = useCallback(() => {
    dispatch({ type: 'RECONNECT_FAILED' });
  }, []);

  // Auto-reconnect on mount if localStorage has saved connection
  useEffect(() => {
    if (savedConn.connected && savedConn.baseUrl) {
      dispatch({ type: 'RECONNECTING' });
      apiRef.current.updateConfig({ baseUrl: savedConn.baseUrl, apiKey: savedConn.apiKey || undefined });

      // Race: reconnect vs 5s timeout
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000));
      Promise.race([apiRef.current.getNodeStatus(), timeout]).then(
        (status) => {
          dispatch({
            type: 'CONNECTED',
            payload: {
              did: status.did,
              network: status.network,
              version: status.version,
              baseUrl: savedConn.baseUrl!,
              apiKey: savedConn.apiKey || '',
            },
          });
          // Fetch balance & history right after reconnect
          const did = status.did;
          apiRef.current.getBalance(did).then(
            (bal) => dispatch({ type: 'BALANCE_LOADED', payload: bal }),
            () => dispatch({ type: 'BALANCE_ERROR' }),
          );
          apiRef.current.getTransactions(did, { page: 1, per_page: 15 }).then(
            (res) => dispatch({ type: 'HISTORY_LOADED', payload: { transactions: res.transactions, total: res.total, hasMore: res.hasMore, page: 1 } }),
            () => dispatch({ type: 'HISTORY_ERROR' }),
          );
        },
        () => {
          dispatch({ type: 'RECONNECT_FAILED' });
        },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async (baseUrl: string, apiKey: string) => {
    apiRef.current.updateConfig({ baseUrl, apiKey: apiKey || undefined });
    const status = await apiRef.current.getNodeStatus();

    localStorage.setItem('clawnet_wallet_conn', JSON.stringify({ connected: true, baseUrl, apiKey }));

    dispatch({
      type: 'CONNECTED',
      payload: { did: status.did, network: status.network, version: status.version, baseUrl, apiKey },
    });
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem('clawnet_wallet_conn');
    dispatch({ type: 'DISCONNECTED' });
  }, []);

  const fetchBalance = useCallback(async () => {
    const did = state.connection.did;
    if (!did) return;
    dispatch({ type: 'BALANCE_LOADING' });
    try {
      const bal = await apiRef.current.getBalance(did);
      dispatch({ type: 'BALANCE_LOADED', payload: bal });
    } catch {
      dispatch({ type: 'BALANCE_ERROR' });
      throw new Error('Failed to fetch balance');
    }
  }, [state.connection.did]);

  const fetchHistory = useCallback(async (page = 1) => {
    const did = state.connection.did;
    if (!did) return;
    dispatch({ type: 'HISTORY_LOADING', payload: { page } });
    try {
      const res = await apiRef.current.getTransactions(did, { page, per_page: 15 });
      dispatch({
        type: 'HISTORY_LOADED',
        payload: { transactions: res.transactions, total: res.total, hasMore: res.hasMore, page },
      });
    } catch {
      dispatch({ type: 'HISTORY_ERROR' });
    }
  }, [state.connection.did]);

  const sendTransfer = useCallback(
    async (params: { to: string; amount: number; passphrase: string; memo?: string; fee?: number }) => {
      const did = state.connection.did;
      if (!did) throw new Error('Not connected');
      const result = await apiRef.current.transfer({
        did,
        passphrase: params.passphrase,
        nonce: Date.now(),
        to: params.to,
        amount: params.amount,
        fee: params.fee,
        memo: params.memo,
      });
      // Refresh balance in background
      fetchBalance().catch(() => {});
      return { txHash: result.txHash };
    },
    [state.connection.did, fetchBalance],
  );

  const value = useMemo<WalletContextValue>(
    () => ({ state, api: apiRef.current, connect, disconnect, skipReconnect, fetchBalance, fetchHistory, sendTransfer }),
    [state, connect, disconnect, skipReconnect, fetchBalance, fetchHistory, sendTransfer],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
