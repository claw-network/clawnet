import React, { useState, useRef } from 'react';
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
  IonInput,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  IonTextarea,
  useIonToast,
} from '@ionic/react';
import { sendOutline, checkmarkCircleOutline, copyOutline } from 'ionicons/icons';
import { useWallet } from '../state/WalletContext';
import { formatTokens, truncateAddr } from '../utils/format';

const TransferPage: React.FC = () => {
  const { state, sendTransfer } = useWallet();
  const { balance } = state;
  const [presentToast] = useIonToast();

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('1');
  const [memo, setMemo] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ txHash: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const parsedAmount = parseInt(amount, 10) || 0;
  const parsedFee = parseInt(fee, 10) || 0;
  const total = parsedAmount + parsedFee;
  const canSend = to.startsWith('did:claw:') && parsedAmount > 0 && passphrase.length > 0 && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await sendTransfer({
        to: to.trim(),
        amount: parsedAmount,
        fee: parsedFee,
        passphrase: passphrase.trim(),
        memo: memo.trim() || undefined,
      });
      setResult({ txHash: res.txHash });
      presentToast({ message: 'Transfer successful', duration: 2000, color: 'success', position: 'top' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transfer failed';
      presentToast({ message: msg, duration: 3000, color: 'danger', position: 'top' });
    } finally {
      setSending(false);
    }
  };

  const handleNewTransfer = () => {
    setTo('');
    setAmount('');
    setFee('1');
    setMemo('');
    setPassphrase('');
    setResult(null);
  };

  const copyTxHash = () => {
    if (result) {
      navigator.clipboard.writeText(result.txHash).catch(() => {});
      presentToast({ message: 'Tx hash copied', duration: 1500, color: 'success', position: 'top' });
    }
  };

  if (result) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Transfer</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <div className="ion-padding" style={{ textAlign: 'center', marginTop: '2rem' }}>
            <IonIcon
              icon={checkmarkCircleOutline}
              color="success"
              style={{ fontSize: 64, marginBottom: 16 }}
            />
            <IonText>
              <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Transfer Sent!</h2>
              <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                {formatTokens(parsedAmount)} Tokens → {truncateAddr(to)}
              </p>
            </IonText>

            <IonCard style={{ marginTop: 24, textAlign: 'left' }}>
              <IonCardContent>
                <IonText color="medium"><p style={{ fontSize: '0.78rem', marginBottom: 4 }}>Transaction Hash</p></IonText>
                <div
                  className="mono"
                  onClick={copyTxHash}
                  style={{
                    fontSize: '0.75rem',
                    wordBreak: 'break-all',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {result.txHash}
                  <IonIcon icon={copyOutline} style={{ flexShrink: 0 }} />
                </div>
              </IonCardContent>
            </IonCard>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
              <IonButton onClick={handleNewTransfer}>New Transfer</IonButton>
              <IonButton fill="outline" routerLink="/tabs/dashboard" routerDirection="back">
                Dashboard
              </IonButton>
            </div>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Transfer</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        <div className="ion-padding" ref={formRef}>
          {/* Available balance */}
          <IonText color="medium">
            <p style={{ fontSize: '0.82rem', marginBottom: 16 }}>
              Available: <strong>{formatTokens(balance.available)}</strong> Tokens
            </p>
          </IonText>

          {/* Form */}
          <IonCard>
            <IonCardContent style={{ padding: '16px 12px' }}>
              <IonItem lines="inset">
                <IonInput
                  label="Recipient"
                  labelPlacement="stacked"
                  placeholder="did:claw:z..."
                  value={to}
                  onIonInput={(e) => setTo(e.detail.value || '')}
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
                  placeholder="What's this for?"
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

          {/* Preview */}
          {parsedAmount > 0 && (
            <IonCard style={{ marginTop: 12 }}>
              <IonCardHeader style={{ paddingBottom: 4 }}>
                <IonCardSubtitle>Transfer Preview</IonCardSubtitle>
              </IonCardHeader>
              <IonCardContent>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <IonText color="medium">Amount</IonText>
                  <IonText>{formatTokens(parsedAmount)} T</IonText>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <IonText color="medium">Fee</IonText>
                  <IonText>{formatTokens(parsedFee)} T</IonText>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingTop: 6,
                    borderTop: '1px solid var(--ion-color-step-150)',
                    fontWeight: 700,
                  }}
                >
                  <IonText>Total</IonText>
                  <IonText color={total > balance.available ? 'danger' : undefined}>{formatTokens(total)} T</IonText>
                </div>
                {total > balance.available && (
                  <IonText color="danger" style={{ fontSize: '0.78rem', marginTop: 6, display: 'block' }}>
                    Insufficient balance
                  </IonText>
                )}
              </IonCardContent>
            </IonCard>
          )}

          {/* Submit */}
          <IonButton
            expand="block"
            onClick={handleSend}
            disabled={!canSend || total > balance.available}
            style={{ marginTop: 16 }}
          >
            {sending ? (
              <IonSpinner name="dots" />
            ) : (
              <>
                <IonIcon icon={sendOutline} slot="start" />
                Send Transfer
              </>
            )}
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default TransferPage;
