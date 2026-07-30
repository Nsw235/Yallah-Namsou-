'use client';

import { useState } from 'react';
import { PaymentMethod } from '@/types/database';
import { PAYMENT_METHOD_ICON, PAYMENT_METHOD_LABELS, formatFCFA } from '@/lib/pricing';

const METHODS: PaymentMethod[] = ['cash', 'airtel_money', 'moov_money'];

export default function PaymentModal({
  amount,
  selected,
  onSelect,
  onClose,
}: {
  amount: number | null;
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod, phone?: string) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(selected);
  const [phone, setPhone] = useState('');
  const needsPhone = method === 'airtel_money' || method === 'moov_money';

  function handleConfirm() {
    if (needsPhone && phone.trim().length < 6) return;
    onSelect(method, needsPhone ? phone.trim() : undefined);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fade" onClick={(e) => e.stopPropagation()}>
        <div className="payment-modal-header">
          <h3 style={{ margin: 0 }}>MODE DE PAIEMENT</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="route-sub" style={{ marginBottom: 12 }}>
          Montant du trajet : <strong>{formatFCFA(amount)}</strong>
        </div>

        <div className="payment-methods">
          {METHODS.map((m) => (
            <div
              key={m}
              className={`payment-option ${method === m ? 'selected' : ''}`}
              onClick={() => setMethod(m)}
            >
              <span className="payment-icon">{PAYMENT_METHOD_ICON[m]}</span>
              <span className="payment-label">{PAYMENT_METHOD_LABELS[m]}</span>
              {method === m && <span className="payment-check">✓</span>}
            </div>
          ))}
        </div>

        {method === 'cash' && (
          <div className="pay-box" style={{ marginTop: 12 }}>
            <span>💵</span>
            <div>
              <div className="lbl">PAIEMENT EN ESPÈCES</div>
              <div className="sub">À régler directement au chauffeur en fin de course.</div>
            </div>
          </div>
        )}

        {needsPhone && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>NUMÉRO {PAYMENT_METHOD_LABELS[method].toUpperCase()}</label>
            <input
              type="tel"
              placeholder="Ex : 66 00 00 00"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <div className="route-sub" style={{ marginTop: 6 }}>
              Un transfert {PAYMENT_METHOD_LABELS[method]} de {formatFCFA(amount)} sera à
              effectuer vers ce numéro à la fin de la course. Vous confirmerez vous-même
              une fois le transfert envoyé.
            </div>
          </div>
        )}

        <button
          className="btn cyan"
          style={{ marginTop: 16 }}
          onClick={handleConfirm}
          disabled={needsPhone && phone.trim().length < 6}
        >
          CONFIRMER
        </button>
      </div>
    </div>
  );
}
