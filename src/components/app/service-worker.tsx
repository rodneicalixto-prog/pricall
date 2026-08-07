"use client";

import { useEffect } from "react";

/** Registra o service worker que habilita a instalação como PWA. */
export function RegistroServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const registrar = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Instalação como aplicativo é opcional; a web continua funcionando.
      });
    };
    if (document.readyState === "complete") registrar();
    else window.addEventListener("load", registrar, { once: true });
  }, []);

  return null;
}
