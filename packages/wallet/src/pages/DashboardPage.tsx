import React, { useEffect } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonText,
  IonSkeletonText,
  IonRefresher,
  IonRefresherContent,
  IonList,
  IonItem,
  IonLabel,
  IonChip,
  useIonToast,
  useIonRouter,
  useIonViewWillEnter,
} from '@ionic/react';
import {
  logOutOutline,
  copyOutline,
  refreshOutline,
  sendOutline,
  timeOutline,
  lockClosedOutline,
  arrowUpOutline,
  arrowDownOutline,
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
      <IonHeader>
        <IonToolbar>
          <IonTitle>Dashboard</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleDisconnect} color="danger">
              <IonIcon slot="icon-only" icon={logOutOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding">
          {/* Identity bar */}
          <IonChip onClick={copyDid} style={{ maxWidth: '100%', marginBottom: 8 }}>
            <IonLabel className="mono" style={{ fontSize: '0.78rem' }}>
              {truncateAddr(connection.did, 16, 8)}
            </IonLabel>
            <IonIcon icon={copyOutline} />
          </IonChip>

          <IonText color="medium">
            <p style={{ fontSize: '0.8rem', margin: '0 0 16px' }}>
              {connection.network} · v{connection.version}
            </p>
          </IonText>

          {/* Balance grid */}
          <div className="balance-grid">
            <IonCard className="primary-card" style={{ margin: 0 }}>
              <IonCardHeader style={{ paddingBottom: 4 }}>
                <IonCardSubtitle>Total Balance</IonCardSubtitle>
              </IonCardHeader>
              <IonCardContent>
                {balance.loading ? (
                  <IonSkeletonText animated style={{ width: '60%', height: 32 }} />
                ) : (
                  <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>
                    {formatTokens(balance.balance)}
                    <span style={{ fontSize: '0.9rem', fontWeight: 400, marginLeft: 6, opacity: 0.6 }}>Tokens</span>
                  </div>
                )}
              </IonCardContent>
            </IonCard>

            <IonCard style={{ margin: 0 }}>
              <IonCardHeader style={{ paddingBottom: 4 }}>
                <IonCardSubtitle>Available</IonCardSubtitle>
              </IonCardHeader>
              <IonCardContent>
                {balance.loading ? (
                  <IonSkeletonText animated style={{ width: '50%', height: 24 }} />
                ) : (
                  <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{formatTokens(balance.available)}</div>
                )}
              </IonCardContent>
            </IonCard>

            <IonCard style={{ margin: 0 }}>
              <IonCardHeader style={{ paddingBottom: 4 }}>
                <IonCardSubtitle>Pending</IonCardSubtitle>
              </IonCardHeader>
              <IonCardContent>
                {balance.loading ? (
                  <IonSkeletonText animated style={{ width: '40%', height: 24 }} />
                ) : (
                  <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{formatTokens(balance.pending)}</div>
                )}
              </IonCardContent>
            </IonCard>

            <IonCard style={{ margin: 0 }}>
              <IonCardHeader style={{ paddingBottom: 4 }}>
                <IonCardSubtitle>Locked</IonCardSubtitle>
              </IonCardHeader>
              <IonCardContent>
                {balance.loading ? (
                  <IonSkeletonText animated style={{ width: '40%', height: 24 }} />
                ) : (
                  <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{formatTokens(balance.locked)}</div>
                )}
              </IonCardContent>
            </IonCard>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <IonButton size="small" fill="outline" routerLink="/tabs/transfer">
              <IonIcon icon={sendOutline} slot="start" />
              Send
            </IonButton>
            <IonButton size="small" fill="outline" routerLink="/tabs/history">
              <IonIcon icon={timeOutline} slot="start" />
              History
            </IonButton>
            <IonButton size="small" fill="outline" routerLink="/tabs/escrow">
              <IonIcon icon={lockClosedOutline} slot="start" />
              Escrow
            </IonButton>
            <IonButton
              size="small"
              fill="outline"
              onClick={async () => {
                try {
                  await Promise.all([fetchBalance(), fetchHistory()]);
                  presentToast({ message: 'Refreshed', duration: 1500, color: 'success', position: 'top' });
                } catch {
                  presentToast({ message: 'Refresh failed', duration: 2000, color: 'danger', position: 'top' });
                }
              }}
            >
              <IonIcon icon={refreshOutline} slot="start" />
              Refresh
            </IonButton>
          </div>

          {/* Recent transactions */}
          <IonText>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>Recent Transactions</h3>
          </IonText>

          {history.loading ? (
            <IonList>
              {[...Array(3)].map((_, i) => (
                <IonItem key={i}>
                  <IonSkeletonText animated style={{ width: '100%', height: 40 }} />
                </IonItem>
              ))}
            </IonList>
          ) : recentTx.length === 0 ? (
            <IonCard>
              <IonCardContent style={{ textAlign: 'center', padding: '2rem' }}>
                <IonIcon icon={sendOutline} style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }} />
                <IonText color="medium">
                  <p>No transactions yet</p>
                  <p style={{ fontSize: '0.82rem' }}>Send your first transfer to get started</p>
                </IonText>
              </IonCardContent>
            </IonCard>
          ) : (
            <IonList style={{ borderRadius: 12, overflow: 'hidden' }}>
              {recentTx.map((tx) => {
                const isSent = tx.from === connection.did;
                const isEscrow = tx.type?.includes('escrow');
                return (
                  <IonItem key={tx.txHash} detail={false}>
                    <div
                      className={`tx-icon ${isEscrow ? 'escrow' : isSent ? 'sent' : 'received'}`}
                      slot="start"
                    >
                      <IonIcon icon={isEscrow ? lockClosedOutline : isSent ? arrowUpOutline : arrowDownOutline} />
                    </div>
                    <IonLabel>
                      <h3 style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        {isEscrow ? 'Escrow' : isSent ? 'Sent' : 'Received'}
                      </h3>
                      <p className="mono" style={{ fontSize: '0.75rem' }}>
                        {truncateAddr(isSent ? tx.to : tx.from)}
                      </p>
                    </IonLabel>
                    <div slot="end" style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '0.9rem',
                          color: isSent
                            ? 'var(--ion-color-danger)'
                            : 'var(--ion-color-success)',
                        }}
                      >
                        {isSent ? '−' : '+'}{formatTokens(tx.amount)} T
                      </div>
                      <IonText color="medium">
                        <div style={{ fontSize: '0.72rem' }}>{formatTime(tx.timestamp)}</div>
                      </IonText>
                    </div>
                  </IonItem>
                );
              })}
            </IonList>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default DashboardPage;
