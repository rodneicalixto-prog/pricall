"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { cn, formatarDataHora } from "@/lib/utils";
import {
  Botao,
  Cartao,
  Esqueleto,
  EstadoErro,
  EstadoVazio,
} from "@/components/ui";
import { useEventoTempoReal } from "@/components/app/tempo-real";

type Notificacao = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  relatedConversationId: string | null;
  isRead: boolean;
  createdAt: string;
};

export function TelaNotificacoes() {
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [apenasNaoLidas, setApenasNaoLidas] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (apenasNaoLidas) params.set("unreadOnly", "true");
      const dados = await api<{ items: Notificacao[] }>(
        `/api/notifications?${params}`,
      );
      setItens(dados.items);
      setErro(null);
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
  }, [apenasNaoLidas]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEventoTempoReal(
    ["notification.created", "realtime.reconnected"],
    () => void carregar(),
  );

  async function marcarTodas() {
    await api("/api/notifications", { method: "POST", json: { ids: "all" } });
    await carregar();
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={apenasNaoLidas}
            onChange={(e) => setApenasNaoLidas(e.target.checked)}
            className="size-4 rounded accent-[var(--primaria)]"
          />
          Mostrar apenas não lidas
        </label>
        <Botao
          variante="contorno"
          tamanho="pequeno"
          onClick={marcarTodas}
          iconeEsquerda={<CheckCheck className="size-3.5" aria-hidden />}
        >
          Marcar todas como lidas
        </Botao>
      </div>

      {carregando && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Esqueleto key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {!carregando && erro && (
        <EstadoErro mensagem={erro} aoTentarNovamente={() => void carregar()} />
      )}

      {!carregando && !erro && itens.length === 0 && (
        <EstadoVazio
          titulo="Nenhuma notificação"
          descricao="Você será avisado sobre novos atendimentos, transferências e conversas paradas."
        />
      )}

      <ul className="flex flex-col gap-2">
        {itens.map((item) => {
          const conteudo = (
            <Cartao className={cn(!item.isRead && "border-[var(--primaria)]/40")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{item.title}</p>
                  {item.body && (
                    <p className="mt-0.5 text-sm text-[var(--texto-2)]">
                      {item.body}
                    </p>
                  )}
                </div>
                <time
                  className="shrink-0 text-xs text-[var(--texto-3)]"
                  dateTime={item.createdAt}
                >
                  {formatarDataHora(item.createdAt)}
                </time>
              </div>
            </Cartao>
          );

          return (
            <li key={item.id}>
              {item.relatedConversationId ? (
                <Link href={`/atendimentos/${item.relatedConversationId}`}>
                  {conteudo}
                </Link>
              ) : (
                conteudo
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
