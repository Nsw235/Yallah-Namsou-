import { supabase } from "./supabase";

// Clé publique VAPID — publique par nature (elle sert seulement à identifier
// le serveur qui a le droit d'envoyer, aucun secret ici), donc pas de souci à
// la garder dans le code front.
const CLE_PUBLIQUE_VAPID =
  "BOgNkwKZO0ICJ6STu2AV4OxPaWvP04-9ycyjc_cMf1sNMGZF9agLt5muO4dpTo5ioBoCCu4CbL8ZR7rsnP93_BM";

function urlBase64VersUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Sur = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(base64Sur);
  return Uint8Array.from([...brut].map((c) => c.charCodeAt(0)));
}

export function pushEstSupporte() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

// À appeler quand l'utilisateur active un des deux réglages de notification.
// Demande la permission navigateur si besoin, s'abonne, et enregistre
// l'abonnement en base pour que notifier-push puisse l'utiliser.
export async function activerNotificationsPush() {
  if (!pushEstSupporte()) return { ok: false, raison: "non_supporte" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, raison: "refuse" };

  const enregistrement = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let abonnement = await enregistrement.pushManager.getSubscription();
  if (!abonnement) {
    abonnement = await enregistrement.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64VersUint8Array(CLE_PUBLIQUE_VAPID),
    });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, raison: "non_connecte" };

  const cle = abonnement.toJSON().keys;
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      utilisateur_id: user.id,
      endpoint: abonnement.endpoint,
      p256dh: cle.p256dh,
      auth: cle.auth,
    },
    { onConflict: "endpoint" }
  );

  if (error) return { ok: false, raison: "erreur_serveur" };
  return { ok: true };
}
