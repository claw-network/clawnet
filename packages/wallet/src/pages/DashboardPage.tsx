import React, { useEffect } from 'react';
import {
  IonContent,
  IonPage,
  IonIcon,
  IonText,
  IonSkeletonText,
  IonRefresher,
  IonRefresherContent,
  useIonToast,
  useIonRouter,
  useIonViewWillEnter,
} from '@ionic/react';
import {
  logOutOutline,
  copyOutline,
  arrowUpOutline,
  arrowDownOutline,
  lockClosedOutline,
  swapVerticalOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import { useWallet } from '../state/WalletContext';
import { formatTokens, formatTime, truncateAddr } from '../utils/format';

const DashboardPage: React.FC = () => {
  const { state, disconnect, fetchBalance, fetchHistory } = useWallet();
  const { balance, connection, history } = state;
  const [presentToast] = useIonToast();
  const router = useIonRouter();

  useIonViewWillEnter(() => {
    if (connection.connected) {
      fetchBalance().catch(() => {});
      fetchHistory().catch(() => {});
    }
  });

  useEffect(() => {
    if (!connection.connected) {
      router.push('/connect', 'root', 'replace');
    }
  }, [connection.connected, router]);

  const handleRefresh = async (event: CustomEvent) => {
    try {
      await Promise.all([fetchBalance(), fetchHistory()]);
    } catch { /* ignore */ }
    event.detail.complete();
  };

  const copyDid = () => {
    navigator.clipboard.writeText(connection.did).catch(() => {});
    presentToast({ message: 'DID copied', duration: 1500, color: 'success', position: 'top' });
  };

  const handleDisconnect = () => {
    disconnect();
    router.push('/connect', 'root', 'replace');
  };

  const recentTx = history.transactions.slice(0, 5);

  return (
    <IonPage>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {/* ── Hero balance area ── */}
        <div className="dash-hero">
          {/* Top bar */}
          <div className="dash-topbar">
            <div className="dash-network-badge">
              <span className="dash-network-dot" />
              {connection.network}
            </div>
            <button className="dash-icon-btn" onClick={handleDisconnect} aria-label="Disconnect">
              <IonIcon icon={logOutOutline} />
            </button>
          </div>

          {/* DID chip */}
          <button className="dash-did-chip" onClick={copyDid}>
            <span className="mono">{truncateAddr(connection.did, 12, 6)}</span>
            <IonIcon icon={copyOutline} style={{ fontSize: 13, opacity: 0.45 }} />
          </button>

          {/* Main balance */}
          <div className="dash-balance-main">
            {balance.loading ? (
              <IonSkeletonText animated style={{ width: 180, height: 48, margin: '0 auto', borderRadius: 8 }} />
            ) : (
              <>
                <span className="dash-balance-amount">{formatTokens(balance.balance)}</span>
                <span className="dash-balance-unit">Tokens</span>
              </>
            )}
          </div>

          {/* Sub-balances */}
          <div className="dash-balance-sub">
            <div className="dash-sub-item">
              <span className="dash-sub-label">Available</span>
              <span className="dash-sub-value">{balance.loading ? '—' : formatTokens(balance.available)}</span>
            </div>
            <div className="dash-sub-divider" />
            <div className="dash-sub-item">
              <span className="dash-sub-label">Pending</span>
              <span className="dash-sub-value">{balance.loading ? '—' : formatTokens(balance.pending)}</span>
            </div>
            <div className="dash-sub-divider" />
            <div className="dash-sub-item">
              <span className="dash-sub-label">Locked</span>
              <span className="dash-sub-value">{balance.loading ? '—' : formatTokens(balance.locked)}</span>
            </div>
          </div>

          {/* Action circles */}
          <div className="dash-actions">
            <button className="dash-action-btn" onClick={() => router.push('/tabs/transfer')}>
              <div className="dash-action-circle">
                <IonIcon icon={arrowUpOutline} />
              </div>
              <span>Send</span>
            </button>
            <button className="dash-action-btn" onClick={copyDid}>
              <div className="dash-action-circle receive">
                <IonIcon icon={arrowDownOutline} />
              </div>
              <span>Receive</span>
            </button>
            <button className="dash-action-btn" onClick={() => router.push('/tabs/escrow')}>
              <div className="dash-action-circle escrow">
                <IonIcon icon={shieldCheckmarkOutline} />
              </div>
              <span>Escrow</span>
            </button>
            <button className="dash-action-btn" onClick={() => router.push('/tabs/history')}>
              <div className="dash-action-circle history">
                <IonIcon icon={swapVerticalOutline} />
              </div>
              <span>History</span>
            </button>
          </div>
        </div>

        {/* ── Transactions section ── */}
        <div className="dash-tx-section">
          <div className="dash-section-header">
            <h3>Transactions</h3>
            {recentTx.length > 0 && (
              <button className="dash-see-all" onClick={() => router.push('/tabs/history')}>
                See all
              </button>
            )}
          </div>

          {history.loading ? (
            <div className="dash-tx-list">
              {[...Array(3)].map((_, i) => (
                <div className="dash-tx-item" key={i}>
                  <IonSkeletonText animated style={{ width: 40, height: 40, borderRadius: 12 }} />
                  <div style={{ flex: 1, padding: '0 12px' }}>
                    <IonSkeletonText animated style={{ width: '40%', height: 14, marginBottom: 6, borderRadius: 4 }} />
                    <IonSkeletonText animated style={{ width: '60%', height: 11, borderRadius: 4 }} />
                  </div>
                  <IonSkeletonText animated style={{ width: 56, height: 14, borderRadius: 4 }} />
                </div>
              ))}
            </div>
          ) : recentTx.length === 0 ? (
            <div className="dash-tx-empty">
              <IonIcon icon={swapVerticalOutline} />
              <IonText color="medium">
                <p>No transactions yet</p>
                <p style={{ fontSize: '0.78rem', opacity: 0.6 }}>Send your first transfer to get started</p>
              </IonText>
            </div>
          ) : (
            <div className="dash-tx-list">
              {recentTx.map((tx) => {
                const isSent = tx.from === connection.did;
                const isEscrow = tx.type?.includes('escrow');
                const icon = isEscrow ? lockClosedOutline : isSent ? arrowUpOutline : arrowDownOutline;
                const label = isEscrow ? 'Escrow' : isSent ? 'Sent' : 'Received';
                const variant = isEscrow ? 'escrow' : isSent ? 'sent' : 'received';

                return (
                  <div className="dash-tx-item" key={tx.txHash}>
                    <div className={`tx-icon ${variant}`}>
                      <IonIcon icon={icon} />
                    </div>
                    <div className="dash-tx-info">
                      <span className="dash-tx-label">{label}</span>
                      <span className="dash-tx-addr mono">
                        {isSent ? 'To ' : 'From '}{truncateAddr(isSent ? tx.to : tx.from, 10, 4)}
                      </span>
                    </div>
                    <div className="dash-tx-right">
                      <span className={`dash-tx-amount ${variant}`}>
                        {isSent ? '−' : '+'}{formatTokens(tx.amount)}
                      </span>
                      <span className="dash-tx-time">{formatTime(tx.timestamp)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default DashboardPage;
