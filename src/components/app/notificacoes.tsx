"use client";

/**
 * Central de notificações: sino com contador, lista e ações de leitura.
 * Recebe novidades pelo canal de tempo real e toca o som opcional.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { cn, tempoRelativo } from "@/lib/utils";
import { Botao, EstadoVazio, Esqueleto } from "@/components/ui";
import { useSessao } from "./sessao";
import { useEventoTempoReal } from "./tempo-real";

type Notificacao = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  relatedConversationId: string | null;
  isRead: boolean;
  createdAt: string;
};

const EVENTOS = ["notification.created", "realtime.reconnected"];

export function SinoNotificacoes() {
  const { preferencias } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const painel = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const dados = await api<{ items: Notificacao[]; unreadCount: number }>(
        "/api/notifications?limit=25",
      );
      setItens(dados.items);
      setNaoLidas(dados.unreadCount);
      setErro(null);
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEventoTempoReal(EVENTOS, () => {
    void carregar();
    if (preferencias.notificationSound) tocarSom();
  });

  // Fecha ao clicar fora ou pressionar Esc.
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (evento: MouseEvent) => {
      if (painel.current && !painel.current.contains(evento.target as Node)) {
        setAberto(false);
      }
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  async function marcarTodas() {
    setNaoLidas(0);
    setItens((atual) => atual.map((i) => ({ ...i, isRead: true })));
    try {
      await api("/api/notifications", { method: "POST", json: { ids: "all" } });
    } catch {
      void carregar();
    }
  }

  async function marcarUma(id: string) {
    setItens((atual) =>
      atual.map((i) => (i.id === id ? { ...i, isRead: true } : i)),
    );
    setNaoLidas((n) => Math.max(0, n - 1));
    try {
      await api("/api/notifications", { method: "POST", json: { ids: [id] } });
    } catch {
      void carregar();
    }
  }

  return (
    <div className="relative" ref={painel}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        aria-label={
          naoLidas > 0
            ? `Notificações: ${naoLidas} não lidas`
            : "Notificações"
        }
        className="relative flex size-11 items-center justify-center rounded-lg text-[var(--texto-2)] transition-colors hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]"
      >
        <Bell className="size-5" aria-hidden />
        {naoLidas > 0 && (
          <span className="absolute top-1.5 right-1.5 flex min-w-4.5 items-center justify-center rounded-full bg-[var(--color-erro)] px-1 text-[10px] font-bold text-white">
            {naoLidas > 99 ? "99+" : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Central de notificações"
          className="absolute right-0 z-50 mt-2 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-[var(--borda)] bg-[var(--superficie)] shadow-xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-[var(--borda)] px-4 py-3">
            <h2 className="text-sm font-semibold">Notificações</h2>
            {naoLidas > 0 && (
              <Botao
                variante="sutil"
                tamanho="pequeno"
                onClick={marcarTodas}
                iconeEsquerda={<CheckCheck className="size-3.5" aria-hidden />}
              >
                Marcar todas
              </Botao>
            )}
          </header>

          <div className="flex-1 overflow-y-auto">
            {carregando && (
              <div className="flex flex-col gap-3 p-4">
                <Esqueleto className="h-12" />
                <Esqueleto className="h-12" />
                <Esqueleto className="h-12" />
              </div>
            )}

            {!carregando && erro && (
              <p role="alert" className="p-4 text-sm text-[var(--color-erro)]">
                {erro}
              </p>
            )}

            {!carregando && !erro && itens.length === 0 && (
              <EstadoVazio
                titulo="Nenhuma notificação"
                descricao="Você será avisado quando houver novidades nos atendimentos."
              />
            )}

            <ul>
              {itens.map((item) => {
                const conteudo = (
                  <div
                    className={cn(
                      "flex flex-col gap-1 border-b border-[var(--borda)] px-4 py-3 text-left transition-colors hover:bg-[var(--superficie-2)]",
                      !item.isRead && "bg-[var(--primaria)]/6",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!item.isRead && (
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--primaria)]"
                          aria-label="Não lida"
                        />
                      )}
                      <p className="flex-1 text-sm font-medium">{item.title}</p>
                      <time
                        className="shrink-0 text-xs text-[var(--texto-3)]"
                        dateTime={item.createdAt}
                      >
                        {tempoRelativo(item.createdAt)}
                      </time>
                    </div>
                    {item.body && (
                      <p className="pl-4 text-sm text-[var(--texto-2)]">
                        {item.body}
                      </p>
                    )}
                  </div>
                );

                return (
                  <li key={item.id}>
                    {item.relatedConversationId ? (
                      <Link
                        href={`/atendimentos/${item.relatedConversationId}`}
                        onClick={() => {
                          void marcarUma(item.id);
                          setAberto(false);
                        }}
                        className="block"
                      >
                        {conteudo}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="block w-full"
                        onClick={() => void marcarUma(item.id)}
                      >
                        {conteudo}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <footer className="border-t border-[var(--borda)] p-2">
            <Link
              href="/notificacoes"
              onClick={() => setAberto(false)}
              className="block rounded-lg px-3 py-2 text-center text-sm font-medium text-[var(--primaria)] hover:bg-[var(--superficie-2)]"
            >
              Ver todas
            </Link>
          </footer>
        </div>
      )}
    </div>
  );
}

/** Som curto gerado via Web Audio — sem depender de arquivo externo. */
function tocarSom() {
  try {
    const Contexto =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Contexto) return;

    const contexto = new Contexto();
    const oscilador = contexto.createOscillator();
    const ganho = contexto.createGain();

    oscilador.type = "sine";
    oscilador.frequency.setValueAtTime(880, contexto.currentTime);
    oscilador.frequency.exponentialRampToValueAtTime(
      620,
      contexto.currentTime + 0.12,
    );
    ganho.gain.setValueAtTime(0.0001, contexto.currentTime);
    ganho.gain.exponentialRampToValueAtTime(0.12, contexto.currentTime + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, contexto.currentTime + 0.25);

    oscilador.connect(ganho).connect(contexto.destination);
    oscilador.start();
    oscilador.stop(contexto.currentTime + 0.26);
    setTimeout(() => void contexto.close(), 500);
  } catch {
    /* som é opcional */
  }
}
