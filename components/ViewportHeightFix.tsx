'use client';

import { useEffect } from 'react';

/**
 * Corrige un bug classique du web mobile (surtout Safari iOS) : les unités
 * CSS `dvh`/`svh` sont parfois calculées AVANT que la barre d'adresse ait
 * fini son animation d'apparition/disparition, ce qui donne une hauteur
 * légèrement trop grande — le bas de l'écran (ex: la feuille "Où allez-vous"
 * + véhicules) se retrouve alors coupé par `overflow:hidden`, invisible tant
 * que la page ne se re-mesure pas.
 *
 * On mesure donc la vraie hauteur visible via `visualViewport` (le plus
 * fiable) et on la republie en variable CSS `--app-vh`, tenue à jour sur
 * resize/orientation/scroll. `globals.css` l'utilise en priorité, avec un
 * repli sur `100dvh`/`100svh` tant que ce composant n'a pas encore mesuré
 * (premier rendu serveur, JS pas encore exécuté).
 */
export default function ViewportHeightFix() {
  useEffect(() => {
    function setAppHeight() {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-vh', `${h}px`);
    }

    setAppHeight();
    // Un léger délai supplémentaire couvre le cas où la barre d'adresse
    // termine son animation juste après le premier calcul.
    const t = setTimeout(setAppHeight, 300);

    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    window.visualViewport?.addEventListener('resize', setAppHeight);
    window.visualViewport?.addEventListener('scroll', setAppHeight);

    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', setAppHeight);
      window.removeEventListener('orientationchange', setAppHeight);
      window.visualViewport?.removeEventListener('resize', setAppHeight);
      window.visualViewport?.removeEventListener('scroll', setAppHeight);
    };
  }, []);

  return null;
}
