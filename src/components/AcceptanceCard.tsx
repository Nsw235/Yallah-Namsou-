import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import styles from "./AcceptanceCard.module.css";

export type Proposal = {
  id: string;
  pickupAddress?: string;
  dropoffAddress?: string;
  [key: string]: any;
};

export type AcceptanceCardHandle = {
  pushProposal: (p: Proposal) => void;
  setTripActive: (active: boolean) => void;
  clearQueue: () => void;
  getCurrent: () => Proposal | null;
  sendGpsUpdate: (coords: { lat: number; lng: number }) => Promise<{ sent?: true; dropped?: true; error?: true; reason?: string }>;
};

export type AcceptanceCardProps = {
  onAccept: (p: Proposal) => Promise<void>;
  onReject: (p: Proposal) => Promise<void>;
  gpsSendFn: (coords: { lat: number; lng: number }) => Promise<void>;
  initialQueue?: Proposal[];
  expireSeconds?: number; // default 15
  debounceMs?: number; // default 2000
};

const AcceptanceCard = forwardRef<AcceptanceCardHandle, AcceptanceCardProps>(function AcceptanceCard(
  {
    onAccept,
    onReject,
    gpsSendFn,
    initialQueue = [],
    expireSeconds = 15,
    debounceMs = 2000,
  },
  ref
) {
  const [queue, setQueue] = useState<Proposal[]>([...initialQueue]);
  const [current, setCurrent] = useState<Proposal | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingAction, setProcessingAction] = useState<"accept" | "reject" | null>(null);
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);

  const timerRef = useRef<number | null>(null);
  const actionLockRef = useRef<boolean>(false);
  const actionTimeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const lastGpsSentRef = useRef<number>(0);
  const tripActiveRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    // show first if any
    showNextIfNeeded();
    return () => {
      isMountedRef.current = false;
      clearTimer();
      clearActionTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Queue API
  function pushProposal(p: Proposal) {
    if (!p?.id) return;
    setQueue((q) => {
      if (q.some((x) => x.id === p.id) || (current && current.id === p.id)) return q;
      return [...q, p];
    });
  }

  function clearQueue() {
    clearTimer();
    setQueue([]);
    setCurrent(null);
    setSecondsLeft(0);
    setIsProcessing(false);
    setProcessingAction(null);
    setSheetVisible(false);
  }

  function showNextIfNeeded() {
    if (!current) {
      setQueue((q) => {
        if (!q || q.length === 0) {
          setSheetVisible(false);
          return q;
        }
        const [next, ...rest] = q;
        setCurrent(next);
        // trigger animation
        requestAnimationFrame(() => setSheetVisible(true));
        startExpiryTimer(expireSeconds);
        return rest;
      });
    }
  }

  useEffect(() => {
    if (!current) {
      // delay small to allow hide animation
      const t = window.setTimeout(() => showNextIfNeeded(), 220);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Timer
  function startExpiryTimer(seconds: number) {
    clearTimer();
    if (!isMountedRef.current) return;
    setSecondsLeft(seconds);
    timerRef.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearTimer();
          dismissCurrent("expired");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }
  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function clearActionTimeout() {
    if (actionTimeoutRef.current) {
      clearTimeout(actionTimeoutRef.current);
      actionTimeoutRef.current = null;
    }
    actionLockRef.current = false;
  }

  function dismissCurrent(reason: "manual" | "action_taken" | "expired") {
    clearTimer();
    clearActionTimeout();
    if (!isMountedRef.current) return;
    setIsProcessing(false);
    setProcessingAction(null);
    setSheetVisible(false);
    // after hide animation remove current
    const t = window.setTimeout(() => {
      if (!isMountedRef.current) return;
      setCurrent(null);
      setSecondsLeft(0);
      clearTimeout(t);
    }, 220);
  }

  // Actions
  async function handleAction(actionType: "accept" | "reject") {
    if (!current) return;
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setIsProcessing(true);
    setProcessingAction(actionType);

    // safety unlock after 6s
    actionTimeoutRef.current = window.setTimeout(() => {
      actionLockRef.current = false;
      actionTimeoutRef.current = null;
      if (isMountedRef.current) {
        setIsProcessing(false);
        setProcessingAction(null);
      }
    }, 6000);

    try {
      if (actionType === "accept") {
        await onAccept(current);
      } else {
        await onReject(current);
      }

      // haptic feedback if available
      try {
        if (navigator && "vibrate" in navigator) {
          (navigator as any).vibrate?.(50);
        }
      } catch {}

      clearActionTimeout();
      // small success delay then debounce lock for debounceMs
      setTimeout(() => {
        if (!isMountedRef.current) return;
        setIsProcessing(false);
        setProcessingAction(null);
        // enforce short debounce before releasing lock
        actionLockRef.current = true;
        actionTimeoutRef.current = window.setTimeout(() => {
          actionLockRef.current = false;
          actionTimeoutRef.current = null;
        }, debounceMs);
        dismissCurrent("action_taken");
      }, 180);
    } catch (err) {
      // on error allow retry after debounceMs
      console.error("Action error:", err);
      clearActionTimeout();
      actionLockRef.current = true;
      actionTimeoutRef.current = window.setTimeout(() => {
        actionLockRef.current = false;
        actionTimeoutRef.current = null;
        if (isMountedRef.current) {
          setIsProcessing(false);
          setProcessingAction(null);
        }
      }, debounceMs);
    }
  }

  function onAcceptClick() {
    if (actionLockRef.current) return;
    handleAction("accept");
  }
  function onRejectClick() {
    if (actionLockRef.current) return;
    handleAction("reject");
  }

  // GPS throttling
  async function sendGpsUpdate(coords: { lat: number; lng: number }) {
    const now = Date.now();
    const minInterval = tripActiveRef.current ? 1000 : 3000;
    if (now - lastGpsSentRef.current < minInterval) {
      return { dropped: true, reason: "throttled" } as const;
    }
    lastGpsSentRef.current = now;
    try {
      await gpsSendFn(coords);
      return { sent: true } as const;
    } catch (err) {
      console.error("GPS send failed:", err);
      return { error: true } as const;
    }
  }

  function setTripActive(active: boolean) {
    tripActiveRef.current = !!active;
  }

  useImperativeHandle(
    ref,
    () => ({
      pushProposal,
      setTripActive,
      clearQueue,
      getCurrent: () => current,
      sendGpsUpdate,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Render
  return (
    <div className="w-full h-[100dvh] overflow-hidden relative" aria-live="polite" aria-atomic="true">
      <div className="absolute inset-0 bg-transparent pointer-events-none" />
      <div
        className={`${styles.bottomSheet} ${sheetVisible ? styles.sheetVisible : styles.sheetHidden}`}
        role="dialog"
        aria-label={current ? "Nouvelle course" : "Aucune proposition en attente"}
      >
        {current ? (
          <div className="text-white">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">Nouvelle proposition</div>
              <div className="text-xs opacity-60">{secondsLeft}s</div>
            </div>

            <div className="mb-4">
              <div className={styles.addressRow}>
                <span className={styles.addressIcon} aria-hidden>
                  🟢
                </span>
                <div className={styles.addressText} title={current.pickupAddress ?? ""}>
                  {current.pickupAddress ?? "Adresse de départ inconnue"}
                </div>
              </div>

              <div className={styles.addressRow}>
                <span className={styles.addressIcon} aria-hidden>
                  🔴
                </span>
                <div className={styles.addressText} title={current.dropoffAddress ?? ""}>
                  {current.dropoffAddress ?? "Adresse d'arrivée inconnue"}
                </div>
              </div>
            </div>

            <div className="flex gap-3 w-full">
              <button
                type="button"
                onClick={onRejectClick}
                disabled={isProcessing && processingAction !== "accept"}
                className="flex-1 rounded-md text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#5A1818", minHeight: 54 }}
                aria-label="Refuser la course"
              >
                {processingAction === "reject" ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <svg className={styles.spin} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.25)" strokeWidth="4" fill="none" />
                      <path d="M22 12a10 10 0 00-10-10" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" />
                    </svg>
                    Refuser
                  </span>
                ) : (
                  "Refuser"
                )}
              </button>

              <button
                type="button"
                onClick={onAcceptClick}
                disabled={isProcessing && processingAction !== "reject"}
                className="flex-1 rounded-md text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#1B5E20", minHeight: 54 }}
                aria-label="Accepter la course"
              >
                {processingAction === "accept" ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <svg className={styles.spin} width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.25)" strokeWidth="4" fill="none" />
                      <path d="M22 12a10 10 0 00-10-10" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" />
                    </svg>
                    Accepter
                  </span>
                ) : (
                  "Accepter"
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-white opacity-80 text-center py-6">
            <div className="text-sm">Aucune proposition active</div>
            <div className="text-xs opacity-60 mt-1">En attente de nouvelles courses…</div>
          </div>
        )}
      </div>
    </div>
  );
});

export default AcceptanceCard;
