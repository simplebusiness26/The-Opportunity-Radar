'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker so Radar installs as an app on a phone.
 *
 * The worker caches only the shell; data always comes from the network. See
 * public/sw.js for why.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Registering during development competes with hot reload for control of
    // the page, so it is left to production builds.
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // An unavailable worker costs only offline support; the app still works.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
