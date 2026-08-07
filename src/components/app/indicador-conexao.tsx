"use client";

import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useTempoReal } from "./tempo-real";

/** Mostra o estado da conexão em tempo real (e avisa quando cai). */
export function IndicadorConexao() {
  const { conectado, online } = useTempoReal();

  if (!online) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-erro)]/12 px-2.5 py-1.5 text-xs font-medium text-[var(--color-erro)]"
        title="Você está offline. As atualizações serão retomadas quando a conexão voltar."
      >
        <CloudOff className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Offline</span>
      </span>
    );
  }

  if (!conectado) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-alerta)]/12 px-2.5 py-1.5 text-xs font-medium text-[var(--color-alerta)]"
        title="Reconectando ao canal de atualizações em tempo real."
      >
        <RefreshCw className="size-3.5 animate-spin" aria-hidden />
        <span className="hidden sm:inline">Reconectando</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--texto-3)]"
      title="Atualizações em tempo real ativas."
    >
      <Wifi className="size-3.5" aria-hidden />
      <span className="apenas-leitor-tela">Conectado em tempo real</span>
    </span>
  );
}
