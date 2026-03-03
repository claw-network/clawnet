import React, { useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonToolbar,
  IonTitle,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  IonList,
  IonChip,
  IonModal,
  IonButtons,
  IonTextarea,
  IonSkeletonText,
  useIonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import {
  lockClosedOutline,
  addOutline,
  searchOutline,
  closeOutline,
  checkmarkCircleOutline,
  timeOutline,
  alertCircleOutline,
} from 'ionicons/icons';
import { useWallet } from '../state/WalletContext';
import { formatTokens, formatTime, truncateAddr } from '../utils/format';

interface EscrowInfo {
  escrowId: string;
  buyer: string;
  seller: string;
  amount: number;
  status: string;
  createdAt: string;
}

const statusColor = (s: string) => {
  switch (s) {
    case 'active': return 'warning';
    case 'released': return 'success';
    case 'disputed': return 'danger';
    case 'refunded': return 'medium';
    default: return 'medium';
  }
};

const statusIcon = (s: string) => {
  switch (s) {
    case 'active': return timeOutline;
    case 'released': return checkmarkCircleOutline;
    case 'disputed': return alertCircleOutline;
    default: return lockClosedOutline;
  }
};

const EscrowPage: React.FC = () => {
  const { state, api } = useWallet();
  const { connection } = state;
  const [presentToast] = useIonToast();

  // Create escrow state
  const [showCreate, setShowCreate] = useState(false);
  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('1');
  const [passphrase, setPassphrase] = useState('');
  const [memo, setMemo] = useState('');
  const [creating, setCreating] = useState(false);

  // Lookup state
  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<EscrowInfo | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Escrow list (from transactions)
  const escrowTxs = state.history.transactions.filter((t) => t.type?.includes('escrow'));

  useIonViewWillEnter(() => {
    // reset lookup on re-enter
    setLookupResult(null);
  });

  const handleCreate = async () => {
    const parsedAmount = parseInt(amount, 10) || 0;
    const parsedFee = parseInt(fee, 10) || 0;
    if (!seller.startsWith('did:claw:') || parsedAmount <= 0 || !passphrase) return;
    setCreating(true);
    try {
      const res = await api.createEscrow({
        did: connection.did,
        seller: seller.trim(),
        amount: parsedAmount,
        fee: parsedFee,
        passphrase: passphrase.trim(),
        memo: memo.trim() || undefined,
      }) as Record<string, unknown>;
      presentToast({
        message: `Escrow created: ${res.escrowId}`,
        duration: 3000,
        color: 'success',
        position: 'top',
      });
      setShowCreate(false);
      resetForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      presentToast({ message: msg, duration: 3000, color: 'danger', position: 'top' });
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setSeller('');
    setAmount('');
    setFee('1');
    setPassphrase('');
    setMemo('');
  };

  const handleLookup = async () => {
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const res = await api.getEscrow(lookupId.trim());
      setLookupResult(res as EscrowInfo);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Escrow not found';
      presentToast({ message: msg, duration: 2500, color: 'danger', position: 'top' });
    } finally {
      setLookupLoading(false);
    }
  };



  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Escrow</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setShowCreate(true)}>
              <IonIcon icon={addOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        <div className="ion-padding">
          {/* Lookup */}
          <IonCard>
            <IonCardHeader style={{ paddingBottom: 4 }}>
              <IonCardSubtitle>Lookup Escrow</IonCardSubtitle>
            </IonCardHeader>
            <IonCardContent>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <IonItem lines="none" style={{ flex: 1, '--padding-start': '0' }}>
                  <IonInput
                    placeholder="Escrow ID"
                    value={lookupId}
                    onIonInput={(e) => setLookupId(e.detail.value || '')}
                    className="mono"
                    style={{ fontSize: '0.85rem' }}
                  />
                </IonItem>
                <IonButton onClick={handleLookup} disabled={lookupLoading || !lookupId.trim()}>
                  {lookupLoading ? <IonSpinner name="dots" /> : <IonIcon icon={searchOutline} slot="icon-only" />}
                </IonButton>
              </div>

              {lookupResult && (
                <div style={{ marginTop: 12, padding: '12px 0', borderTop: '1px solid var(--ion-color-step-150)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <IonChip color={statusColor(lookupResult.status)}>
                      <IonIcon icon={statusIcon(lookupResult.status)} />
                      <IonLabel>{lookupResult.status}</IonLabel>
                    </IonChip>
                    <IonText style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                      {formatTokens(lookupResult.amount)} T
                    </IonText>
                  </div>
                  <div style={{ fontSize: '0.78rem', lineHeight: 1.7 }}>
                    <div><IonText color="medium">Buyer: </IonText><span className="mono">{truncateAddr(lookupResult.buyer)}</span></div>
                    <div><IonText color="medium">Seller: </IonText><span className="mono">{truncateAddr(lookupResult.seller)}</span></div>
                    <div><IonText color="medium">Created: </IonText>{formatTime(new Date(lookupResult.createdAt).getTime())}</div>
                  </div>
                </div>
              )}
            </IonCardContent>
          </IonCard>

          {/* Recent escrow transactions */}
          <IonText>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginTop: 20, marginBottom: 8 }}>
              Escrow Transactions
            </h3>
          </IonText>

          {state.history.loading ? (
            <IonList>
              {[...Array(3)].map((_, i) => (
                <IonItem key={i}>
                  <IonSkeletonText animated style={{ width: '100%', height: 44 }} />
                </IonItem>
              ))}
            </IonList>
          ) : escrowTxs.length === 0 ? (
            <IonCard>
              <IonCardContent style={{ textAlign: 'center', padding: '2rem' }}>
                <IonIcon icon={lockClosedOutline} style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }} />
                <IonText color="medium">
                  <p>No escrow transactions yet</p>
                </IonText>
              </IonCardContent>
            </IonCard>
          ) : (
            <IonList style={{ borderRadius: 12, overflow: 'hidden' }}>
              {escrowTxs.map((tx) => {
                const isBuyer = (tx.type ?? '').toLowerCase().includes('escrow_create') || (tx.type ?? '').toLowerCase() === 'sent';
                return (
                  <IonItem key={tx.txHash} detail={false}>
                    <div className="tx-icon escrow" slot="start">
                      <IonIcon icon={lockClosedOutline} />
                    </div>
                    <IonLabel>
                      <h3 style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        {isBuyer ? 'Created Escrow' : 'Escrow Payment'}
                      </h3>
                      <p className="mono" style={{ fontSize: '0.72rem' }}>
                        {truncateAddr(isBuyer ? tx.to : tx.from)}
                      </p>
                    </IonLabel>
                    <div slot="end" style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{formatTokens(tx.amount)} T</div>
                      <IonText color="medium">
                        <div style={{ fontSize: '0.7rem' }}>{formatTime(tx.timestamp)}</div>
                      </IonText>
                    </div>
                  </IonItem>
                );
              })}
            </IonList>
          )}
        </div>

        {/* Create Escrow Modal */}
        <IonModal isOpen={showCreate} onDidDismiss={() => setShowCreate(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Create Escrow</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowCreate(false)}>
                  <IonIcon icon={closeOutline} slot="icon-only" />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <div className="ion-padding">
              <IonCard>
                <IonCardContent style={{ padding: '16px 12px' }}>
                  <IonItem lines="inset">
                    <IonInput
                      label="Seller DID"
                      labelPlacement="stacked"
                      placeholder="did:claw:z..."
                      value={seller}
                      onIonInput={(e) => setSeller(e.detail.value || '')}
                      className="mono"
                      style={{ fontSize: '0.85rem' }}
                    />
                  </IonItem>

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <IonItem lines="inset" style={{ flex: 2 }}>
                      <IonInput
                        label="Amount"
                        labelPlacement="stacked"
                        type="number"
                        min="1"
                        placeholder="0"
                        value={amount}
                        onIonInput={(e) => setAmount(e.detail.value || '')}
                      />
                    </IonItem>
                    <IonItem lines="inset" style={{ flex: 1 }}>
                      <IonInput
                        label="Fee"
                        labelPlacement="stacked"
                        type="number"
                        min="0"
                        placeholder="1"
                        value={fee}
                        onIonInput={(e) => setFee(e.detail.value || '')}
                      />
                    </IonItem>
                  </div>

                  <IonItem lines="inset" style={{ marginTop: 8 }}>
                    <IonTextarea
                      label="Memo (optional)"
                      labelPlacement="stacked"
                      placeholder="Escrow description"
                      value={memo}
                      onIonInput={(e) => setMemo(e.detail.value || '')}
                      rows={2}
                    />
                  </IonItem>

                  <IonItem lines="none" style={{ marginTop: 8 }}>
                    <IonInput
                      label="Passphrase"
                      labelPlacement="stacked"
                      type="password"
                      placeholder="Your passphrase"
                      value={passphrase}
                      onIonInput={(e) => setPassphrase(e.detail.value || '')}
                    />
                  </IonItem>
                </IonCardContent>
              </IonCard>

              <IonButton
                expand="block"
                onClick={handleCreate}
                disabled={!seller.startsWith('did:claw:') || (parseInt(amount) || 0) <= 0 || !passphrase || creating}
                style={{ marginTop: 16 }}
              >
                {creating ? (
                  <IonSpinner name="dots" />
                ) : (
                  <>
                    <IonIcon icon={lockClosedOutline} slot="start" />
                    Create Escrow
                  </>
                )}
              </IonButton>
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default EscrowPage;
