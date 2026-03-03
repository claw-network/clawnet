import React, { useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonToolbar,
  IonTitle,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonList,
  IonItem,
  IonIcon,
  IonText,
  IonButton,
  IonCard,
  IonCardContent,
  IonRefresher,
  IonRefresherContent,
  IonSkeletonText,
  useIonViewWillEnter,
} from '@ionic/react';
import {
  arrowUpOutline,
  arrowDownOutline,
  lockClosedOutline,
  sendOutline,
  chevronBackOutline,
  chevronForwardOutline,
} from 'ionicons/icons';
import { useWallet } from '../state/WalletContext';
import { formatTokens, formatTime, truncateAddr } from '../utils/format';

type Filter = 'all' | 'sent' | 'received' | 'escrow';

const HistoryPage: React.FC = () => {
  const { state, fetchHistory } = useWallet();
  const { history, connection } = state;
  const [filter, setFilter] = useState<Filter>('all');

  useIonViewWillEnter(() => {
    if (connection.connected) {
      fetchHistory().catch(() => {});
    }
  });

  const handleRefresh = async (event: CustomEvent) => {
    try {
      await fetchHistory();
    } catch { /* ignore */ }
    event.detail.complete();
  };

  const filtered = history.transactions.filter((tx) => {
    if (filter === 'all') return true;
    // The API returns a `type` field: "sent", "received", "escrow_*", etc.
    // Use it directly since `from`/`to` are EVM addresses, not DIDs.
    const t = (tx.type ?? '').toLowerCase();
    if (filter === 'sent') return t === 'sent' || t === 'transfer_out';
    if (filter === 'received') return t === 'received' || t === 'transfer_in' || t === 'mint';
    if (filter === 'escrow') return t.includes('escrow');
    return true;
  });

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>History</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment
            value={filter}
            onIonChange={(e) => setFilter(e.detail.value as Filter)}
          >
            <IonSegmentButton value="all">
              <IonLabel>All</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="sent">
              <IonLabel>Sent</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="received">
              <IonLabel>Received</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="escrow">
              <IonLabel>Escrow</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding">
          {history.loading ? (
            <IonList>
              {[...Array(5)].map((_, i) => (
                <IonItem key={i}>
                  <IonSkeletonText animated style={{ width: '100%', height: 48 }} />
                </IonItem>
              ))}
            </IonList>
          ) : history.error ? (
            <IonCard>
              <IonCardContent style={{ textAlign: 'center', padding: '2rem' }}>
                <IonText color="danger">
                  <p>{history.error}</p>
                </IonText>
                <IonButton size="small" fill="outline" onClick={() => fetchHistory()}>
                  Retry
                </IonButton>
              </IonCardContent>
            </IonCard>
          ) : filtered.length === 0 ? (
            <IonCard>
              <IonCardContent style={{ textAlign: 'center', padding: '2rem' }}>
                <IonIcon icon={sendOutline} style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }} />
                <IonText color="medium">
                  <p>No {filter === 'all' ? '' : filter + ' '}transactions found</p>
                </IonText>
              </IonCardContent>
            </IonCard>
          ) : (
            <>
              <IonText color="medium">
                <p style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                  {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
                  {history.total > history.transactions.length &&
                    ` (showing ${history.transactions.length} of ${history.total})`}
                </p>
              </IonText>

              <IonList style={{ borderRadius: 12, overflow: 'hidden' }}>
                {filtered.map((tx) => {
                  const t = (tx.type ?? '').toLowerCase();
                  const isEscrow = t.includes('escrow');
                  const isSent = t === 'sent' || t === 'transfer_out';
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
                        <p className="mono" style={{ fontSize: '0.72rem' }}>
                          {isSent ? 'To: ' : 'From: '}
                          {truncateAddr(isSent ? tx.to : tx.from)}
                        </p>
                        {tx.memo && (
                          <p style={{ fontSize: '0.72rem', opacity: 0.7, marginTop: 2 }}>{tx.memo}</p>
                        )}
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
                          <div style={{ fontSize: '0.7rem' }}>{formatTime(tx.timestamp)}</div>
                        </IonText>
                      </div>
                    </IonItem>
                  );
                })}
              </IonList>

              {/* Pagination */}
              {history.total > history.transactions.length && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                  <IonButton
                    size="small"
                    fill="outline"
                    disabled={history.page <= 1}
                    onClick={() => fetchHistory(history.page - 1)}
                  >
                    <IonIcon icon={chevronBackOutline} slot="icon-only" />
                  </IonButton>
                  <IonText color="medium" style={{ alignSelf: 'center', fontSize: '0.82rem' }}>
                    Page {history.page}
                  </IonText>
                  <IonButton
                    size="small"
                    fill="outline"
                    disabled={history.page * 20 >= history.total}
                    onClick={() => fetchHistory(history.page + 1)}
                  >
                    <IonIcon icon={chevronForwardOutline} slot="icon-only" />
                  </IonButton>
                </div>
              )}
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default HistoryPage;
