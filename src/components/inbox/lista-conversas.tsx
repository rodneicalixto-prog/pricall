"use client";

/**
 * Coluna central: lista de conversas.
 * Carregamento progressivo por cursor, busca com debounce, skeleton,
 * estado vazio e atualização em tempo real (só o item que mudou).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Search, Star } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { cn, formatarMinutos, tempoRelativo } from "@/lib/utils";
import {
  Avatar,
  Esqueleto,
  EstadoErro,
  EstadoVazio,
  Etiqueta,
  EtiquetaPrioridade,
} from "@/components/ui";
import { useEventoTempoReal } from "@/components/app/tempo-real";
import type { ChaveFila, ItemConversa } from "./tipos";

const EVENTOS = [
  "conversation.created",
  "conversation.updated",
  "conversation.assigned",
  "conversation.closed",
  "message.created",
  // Revalida após uma queda do canal (comum em serverless).
  "realtime.reconnected",
];

export type FiltrosLista = {
  fila: ChaveFila;
  busca: string;
  vendedorId?: string;
  equipeId?: string;
  marcadorId?: string;
  conexaoId?: string;
  de?: string;
  ate?: string;
};

export function ListaConversas({
  filtros,
  conversaSelecionada,
  aoSelecionar,
  aoMudarBusca,
}: {
  filtros: FiltrosLista;
  conversaSelecionada: string | null;
  aoSelecionar: (id: string) => void;
  aoMudarBusca: (valor: string) => void;
}) {
  const [itens, setItens] = useState<ItemConversa[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscaLocal, setBuscaLocal] = useState(filtros.busca);

  const sentinela = useRef<HTMLDivElement>(null);
  const requisicaoAtual = useRef(0);

  const chaveFiltros = useMemo(() => JSON.stringify(filtros), [filtros]);

  const montarUrl = useCallback(
    (cursorPagina?: string | null) => {
      const params = new URLSearchParams({ queue: filtros.fila, limit: "30" });
      if (filtros.busca) params.set("search", filtros.busca);
      if (filtros.vendedorId) params.set("assignedUserId", filtros.vendedorId);
      if (filtros.equipeId) params.set("teamId", filtros.equipeId);
      if (filtros.marcadorId) params.set("tagId", filtros.marcadorId);
      if (filtros.conexaoId) params.set("connectionId", filtros.conexaoId);
      if (filtros.de) params.set("from", filtros.de);
      if (filtros.ate) params.set("to", filtros.ate);
      if (cursorPagina) params.set("cursor", cursorPagina);
      return `/api/conversations?${params.toString()}`;
    },
    [filtros],
  );

  const carregar = useCallback(async () => {
    const requisicao = ++requisicaoAtual.current;
    setCarregando(true);
    setErro(null);
    try {
      const dados = await api<{ items: ItemConversa[]; nextCursor: string | null }>(
        montarUrl(),
      );
      // Descarta respostas fora de ordem (filtro mudou no meio do caminho).
      if (requisicao !== requisicaoAtual.current) return;
      setItens(dados.items);
      setCursor(dados.nextCursor);
    } catch (error) {
      if (requisicao !== requisicaoAtual.current) return;
      setErro(mensagemDeErro(error));
    } finally {
      if (requisicao === requisicaoAtual.current) setCarregando(false);
    }
  }, [montarUrl]);

  /** Recarrega sem piscar a tela — usado pelos eventos em tempo real. */
  const revalidar = useCallback(async () => {
    try {
      const dados = await api<{ items: ItemConversa[]; nextCursor: string | null }>(
        montarUrl(),
      );
      setItens(dados.items);
      setCursor(dados.nextCursor);
    } catch {
      /* mantém o que já está na tela */
    }
  }, [montarUrl]);

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveFiltros]);

  // Debounce da busca: evita uma consulta por tecla.
  useEffect(() => {
    const temporizador = setTimeout(() => {
      if (buscaLocal !== filtros.busca) aoMudarBusca(buscaLocal);
    }, 350);
    return () => clearTimeout(temporizador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaLocal]);

  useEventoTempoReal(EVENTOS, () => {
    void revalidar();
  });

  // Carregamento progressivo ao chegar no fim da lista.
  useEffect(() => {
    const alvo = sentinela.current;
    if (!alvo || !cursor) return;

    const observador = new IntersectionObserver(
      async ([entrada]) => {
        if (!entrada.isIntersecting || carregandoMais) return;
        setCarregandoMais(true);
        try {
          const dados = await api<{
            items: ItemConversa[];
            nextCursor: string | null;
          }>(montarUrl(cursor));
          setItens((atual) => {
            const existentes = new Set(atual.map((i) => i.id));
            return [...atual, ...dados.items.filter((i) => !existentes.has(i.id))];
          });
          setCursor(dados.nextCursor);
        } catch {
          /* silencioso: o usuário pode rolar de novo */
        } finally {
          setCarregandoMais(false);
        }
      },
      { rootMargin: "200px" },
    );

    observador.observe(alvo);
    return () => observador.disconnect();
  }, [cursor, carregandoMais, montarUrl]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[var(--borda)] p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--texto-3)]"
            aria-hidden
          />
          <input
            type="search"
            value={buscaLocal}
            onChange={(e) => setBuscaLocal(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            aria-label="Buscar conversas"
            className="min-h-11 w-full rounded-lg border border-[var(--borda)] bg-[var(--superficie)] pr-3 pl-9 text-sm placeholder:text-[var(--texto-3)] focus:border-[var(--primaria)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="feed" aria-busy={carregando}>
        {carregando && (
          <ul className="flex flex-col">
            {Array.from({ length: 7 }).map((_, indice) => (
              <li
                key={indice}
                className="flex gap-3 border-b border-[var(--borda)] p-3"
              >
                <Esqueleto className="size-10 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Esqueleto className="h-3.5 w-2/5" />
                  <Esqueleto className="h-3 w-4/5" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {!carregando && erro && (
          <EstadoErro mensagem={erro} aoTentarNovamente={() => void carregar()} />
        )}

        {!carregando && !erro && itens.length === 0 && (
          <EstadoVazio
            titulo={
              filtros.busca
                ? "Nenhuma conversa encontrada"
                : "Nenhuma conversa aguardando atendimento."
            }
            descricao={
              filtros.busca
                ? "Tente outro nome ou telefone."
                : "Assim que um cliente enviar mensagem, ela aparece aqui."
            }
          />
        )}

        {!carregando && !erro && itens.length > 0 && (
          <ul className="flex flex-col">
            {itens.map((item) => (
              <li key={item.id}>
                <ItemLista
                  item={item}
                  selecionado={item.id === conversaSelecionada}
                  aoSelecionar={() => aoSelecionar(item.id)}
                />
              </li>
            ))}
          </ul>
        )}

        {cursor && (
          <div ref={sentinela} className="p-4 text-center">
            {carregandoMais && (
              <span className="text-xs text-[var(--texto-2)]">
                Carregando mais conversas…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemLista({
  item,
  selecionado,
  aoSelecionar,
}: {
  item: ItemConversa;
  selecionado: boolean;
  aoSelecionar: () => void;
}) {
  const parada = item.stalledMinutes != null && item.stalledMinutes >= 30;

  return (
    <button
      type="button"
      onClick={aoSelecionar}
      aria-current={selecionado ? "true" : undefined}
      className={cn(
        "flex w-full gap-3 border-b border-[var(--borda)] p-3 text-left transition-colors",
        "hover:bg-[var(--superficie-2)]",
        selecionado && "bg-[var(--primaria)]/10",
      )}
    >
      <Avatar
        nome={item.contact.name}
        url={item.contact.profilePictureUrl}
        tamanho={42}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold">
            {item.contact.name}
          </span>
          <time
            className="shrink-0 text-xs text-[var(--texto-3)]"
            dateTime={item.lastMessageAt}
          >
            {tempoRelativo(item.lastMessageAt)}
          </time>
        </div>

        <p className="truncate text-xs text-[var(--texto-2)]">
          {item.contact.phone}
        </p>

        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-sm text-[var(--texto-2)]">
            {item.lastMessage?.direction === "outbound" && (
              <span className="text-[var(--texto-3)]">Você: </span>
            )}
            {item.lastMessage?.content ?? "Sem mensagens"}
          </p>
          {item.unreadCount > 0 && (
            <span
              className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primaria)] px-1.5 text-[11px] font-bold text-white"
              aria-label={`${item.unreadCount} mensagens não lidas`}
            >
              {item.unreadCount > 99 ? "99+" : item.unreadCount}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {item.isFavorite && (
            <Star
              className="size-3.5 fill-[var(--color-alerta)] text-[var(--color-alerta)]"
              aria-label="Favorito"
            />
          )}
          <EtiquetaPrioridade prioridade={item.priority} />
          {parada && (
            <Etiqueta cor="#DC2626">
              <AlertTriangle className="size-3" aria-hidden />
              Parada há {formatarMinutos(item.stalledMinutes!)}
            </Etiqueta>
          )}
          {item.assignedUserName ? (
            <span className="truncate text-xs text-[var(--texto-3)]">
              {item.assignedUserName}
            </span>
          ) : (
            <Etiqueta cor="#F59E0B">Sem responsável</Etiqueta>
          )}
          {item.tags.slice(0, 2).map((marcador) => (
            <Etiqueta key={marcador.id} cor={marcador.color}>
              {marcador.name}
            </Etiqueta>
          ))}
          {item.tags.length > 2 && (
            <span className="text-xs text-[var(--texto-3)]">
              +{item.tags.length - 2}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
