import React from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonIcon,
  useIonToast,
} from '@ionic/react';
import {
  closeOutline,
  copyOutline,
  arrowUpOutline,
  arrowDownOutline,
  lockClosedOutline,
  checkmarkCircleOutline,
  timeOutline,
  alertCircleOutline,
} from 'ionicons/icons';
import type { Transaction } from '../state/WalletContext';
import { formatTokens } from '../utils/format';

interface TxDetailModalProps {
  tx: Transaction | null;
  isOpen: boolean;
  onClose: () => void;
}

const TxDetailModal: React.FC<TxDetailModalProps> = ({ tx, isOpen, onClose }) => {
  const [presentToast] = useIonToast();

  if (!tx) return null;

  const t = (tx.type ?? '').toLowerCase();
  const isEscrow = t.includes('escrow');
  const isSent = t === 'sent' || t === 'transfer_out';
  const label = isEscrow ? 'Escrow' : isSent ? 'Sent' : 'Received';
  const variant = isEscrow ? 'escrow' : isSent ? 'sent' : 'received';

  const statusIcon = tx.status === 'confirmed'
    ? checkmarkCircleOutline
    : tx.status === 'failed'
      ? alertCircleOutline
      : timeOutline;
  const statusColor = tx.status === 'confirmed'
    ? 'var(--ion-color-success)'
    : tx.status === 'failed'
      ? 'var(--ion-color-danger)'
      : 'var(--ion-color-warning)';

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    presentToast({ message: `${what} copied`, duration: 1500, color: 'success', position: 'top' });
  };

  const rows: Array<{ label: string; value: string; mono?: boolean; copyable?: boolean }> = [
    { label: 'Tx Hash', value: tx.txHash, mono: true, copyable: true },
    { label: 'From', value: tx.from, mono: true, copyable: true },
    { label: 'To', value: tx.to, mono: true, copyable: true },
    { label: 'Amount', value: `${formatTokens(tx.amount)} Tokens` },
    ...(tx.fee != null ? [{ label: 'Fee', value: `${formatTokens(tx.fee)} Tokens` }] : []),
    { label: 'Type', value: tx.type ?? '—' },
    { label: 'Status', value: tx.status ?? '—' },
    { label: 'Time', value: tx.timestamp ? new Date(tx.timestamp < 1e12 ? tx.timestamp * 1000 : tx.timestamp).toLocaleString() : '—' },
    ...(tx.memo ? [{ label: 'Memo', value: tx.memo }] : []),
  ];

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} breakpoints={[0, 0.85]} initialBreakpoint={0.85}>
      <IonHeader>
        <IonToolbar>
          <IonTitle style={{ fontSize: '1rem' }}>Transaction Detail</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>
              <IonIcon icon={closeOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="txd-container">
          {/* Header icon + amount */}
          <div className="txd-header">
            <div className={`txd-icon-lg ${variant}`}>
              <IonIcon icon={isEscrow ? lockClosedOutline : isSent ? arrowUpOutline : arrowDownOutline} />
            </div>
            <div className={`txd-amount ${variant}`}>
              {isSent ? '−' : '+'}{formatTokens(tx.amount)}
            </div>
            <div className="txd-type">{label}</div>
            <div className="txd-status" style={{ color: statusColor }}>
              <IonIcon icon={statusIcon} style={{ fontSize: 14, marginRight: 4 }} />
              {tx.status}
            </div>
          </div>

          {/* Detail rows */}
          <div className="txd-rows">
            {rows.map((row) => (
              <div className="txd-row" key={row.label}>
                <span className="txd-row-label">{row.label}</span>
                <div className="txd-row-value-wrap">
                  <span className={`txd-row-value ${row.mono ? 'mono' : ''}`}>{row.value}</span>
                  {row.copyable && (
                    <button className="txd-copy-btn" onClick={() => copy(row.value, row.label)}>
                      <IonIcon icon={copyOutline} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default TxDetailModal;
