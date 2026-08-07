import { supabase } from '@/lib/supabaseClient';

// Clé publique VAPID — publique par nature (sert seulement à identifier le
// serveur autorisé à envoyer, aucun secret ici), donc pas de souci à la
// garder dans le code front. La clé privée correspondante ne vit que côté
// serveur (secret de la fonction Edge `send-push`).
const VAPID_PUBLIC_KEY = 'BF--dggULkYEumdPjxBOIsi1Y9aj-Nx3bti1tr5eWm3oInDZX0WZpfqgLwX3Uw0ctyu8DZq2yTeVZNrB20BQWSE';

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer;
}

/** true si ce navigateur peut recevoir des notifications push web.
 *  Sur iPhone : uniquement si l'app a été ajoutée à l'écran d'accueil
 *  (Safari 16.4+) — dans l'onglet Safari classique, ce sera toujours false. */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

/** true si l'app tourne en mode "installée" (ajoutée à l'écran d'accueil) —
 *  condition nécessaire pour le push sur iOS. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'not_signed_in' | 'server_error' };

/** À appeler depuis un geste utilisateur (bouton "Activer les notifications").
 *  Demande la permission navigateur si besoin, s'abonne, et enregistre
 *  l'abonnement en base pour que la fonction Edge `send-push` puisse l'utiliser. */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'not_signed_in' };

  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys?.auth) return { ok: false, reason: 'server_error' };

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    { onConflict: 'endpoint' }
  );

  if (error) return { ok: false, reason: 'server_error' };
  return { ok: true };
}

/** Envoie une notification push à un ou plusieurs utilisateurs (best-effort :
 *  ne bloque jamais le flux principal si ça échoue — un chauffeur/passager
 *  sans notifications activées reste géré par le Realtime déjà en place). */
export async function sendPushNotification(userIds: string[], title: string, body: string, url?: string) {
  if (userIds.length === 0) return;
  try {
    await supabase.functions.invoke('send-push', { body: { user_ids: userIds, title, body, url } });
  } catch {
    // best-effort — on ne remonte pas d'erreur au flux appelant
  }
}
