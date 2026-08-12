'use client';

import { useEffect, useRef, useState } from 'react';
import { TripMessage, TripMessageSenderRole } from '@/types/database';
import { getTripMessages, sendTripMessage, subscribeToTripMessages } from '@/lib/rides';
import { useToast } from '@/components/Toast';

/**
 * Messagerie in-app d'une course active — utilisée à la fois côté passager
 * (écrans "chauffeur arrive" / "en course") et côté chauffeur (panneau de
 * course en cours). Les messages sont persistés (table trip_messages,
 * RLS limitée aux deux participants) et synchronisés en temps réel via
 * Supabase Realtime, donc les deux côtés voient la conversation en direct.
 *
 * Le lien SMS ("hors app") reste proposé en repli quand un numéro est
 * disponible, pour les cas où l'autre partie n'a pas l'app ouverte.
 */
export default function ChatModal({
  tripId,
  currentUserId,
  myRole,
  otherPartyName,
  otherPartyPhone,
  onClose,
}: {
  tripId: string;
  currentUserId: string;
  myRole: TripMessageSenderRole;
  otherPartyName: string;
  otherPartyPhone?: string | null;
  onClose: () => void;
}) {
  const pushToast = useToast();
  const [messages, setMessages] = useState<TripMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getTripMessages(tripId)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs);
      })
      .catch((err) => setError(err?.message ?? 'Impossible de charger la conversation.'));

    const unsubscribe = subscribeToTripMessages(tripId, (msg) => {
      setMessages((prev) => {
        if (!prev) return [msg];
        // Le realtime peut renvoyer un message qu'on vient déjà d'ajouter
        // en local (voir handleSend) — on évite le doublon.
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tripId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages?.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    try {
      const saved = await sendTripMessage(tripId, currentUserId, myRole, body);
      setMessages((prev) => (prev ? [...prev, saved] : [saved]));
    } catch (err: any) {
      setDraft(body);
      pushToast(err?.message ?? "Message non envoyé, réessayez.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chat-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{otherPartyName}</h3>

        <div className="chat-scroll" ref={scrollRef}>
          {!messages && !error && <div className="history-empty">Chargement…</div>}
          {error && <div className="auth-error">{error}</div>}
          {messages && messages.length === 0 && (
            <div className="history-empty">Aucun message pour l&apos;instant — dites bonjour.</div>
          )}
          {messages?.map((m) => (
            <div key={m.id} className={`chat-bubble-row ${m.sender_role === myRole ? 'me' : 'them'}`}>
              <div className="chat-bubble">
                <span className="chat-bubble-body">{m.body}</span>
                <span className="chat-bubble-time">
                  {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}
        </div>

        {otherPartyPhone && (
          <a className="chat-sms-fallback" href={`sms:${otherPartyPhone}`}>
            Envoyer un SMS classique à la place →
          </a>
        )}

        <div className="chat-input-row">
          <input
            className="chat-input"
            placeholder="Écrire un message…"
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={sending || !draft.trim()}
            aria-label="Envoyer le message"
          >
            ➤
          </button>
        </div>

        <button className="btn ghost" style={{ width: '100%', marginTop: 10 }} onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}
