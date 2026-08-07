// Service worker minimal : uniquement pour les notifications push.
// N'intercepte aucune requête réseau, ne fait pas de cache offline —
// juste ce qu'il faut pour recevoir une notif même app fermée.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let donnees = { titre: "Yallah Namsou", corps: "Vous avez une nouvelle notification.", url: "/" };
  try {
    donnees = { ...donnees, ...event.data.json() };
  } catch {
    // pas de JSON exploitable, on garde les valeurs par défaut
  }

  event.waitUntil(
    self.registration.showNotification(donnees.titre, {
      body: donnees.corps,
      icon: "/logo.png",
      badge: "/logo.png",
      // Ignoré par iOS Safari (aucune API de vibration sur iOS, quel que
      // soit le canal — Notification ou Push) ; pris en compte sur Android.
      vibrate: [200, 100, 200],
      data: { url: donnees.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((listeClients) => {
      for (const client of listeClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
