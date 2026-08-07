"use client";

/**
 * Kanban pessoal — quadros ilimitados por usuário.
 * O movimento entre colunas funciona por arrastar (desktop) e por menu de
 * seleção (mobile e leitores de tela).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { cn, formatarData } from "@/lib/utils";
import {
  Aviso,
  Botao,
  Campo,
  Esqueleto,
  EstadoErro,
  EstadoVazio,
  Modal,
  useToast,
} from "@/components/ui";

type Quadro = {
  id: string;
  name: string;
  description: string | null;
  cardCount: number;
};

type Coluna = { id: string; name: string; color: string; position: number };

type Card = {
  id: string;
  columnId: string;
  conversationId: string | null;
  title: string;
  notes: string | null;
  value: number | null;
  dueAt: string | null;
  position: number;
  contactName: string | null;
  conversationStatus: string | null;
};

export function TelaKanban() {
  const toast = useToast();
  const [quadros, setQuadros] = useState<Quadro[]>([]);
  const [quadroAtivo, setQuadroAtivo] = useState<string | null>(null);
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modalQuadro, setModalQuadro] = useState(false);
  const [modalCard, setModalCard] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  const carregarQuadros = useCallback(async () => {
    try {
      const dados = await api<{ items: Quadro[] }>("/api/kanban/boards");
      setQuadros(dados.items);
      setQuadroAtivo((atual) => atual ?? dados.items[0]?.id ?? null);
      setErro(null);
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarQuadro = useCallback(async (id: string) => {
    try {
      const dados = await api<{ columns: Coluna[]; cards: Card[] }>(
        `/api/kanban/boards/${id}`,
      );
      setColunas(dados.columns);
      setCards(dados.cards);
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void carregarQuadros();
  }, [carregarQuadros]);

  useEffect(() => {
    if (quadroAtivo) void carregarQuadro(quadroAtivo);
  }, [quadroAtivo, carregarQuadro]);

  async function moverCard(cardId: string, colunaId: string) {
    const destino = cards.filter((c) => c.columnId === colunaId).length;
    // Atualização otimista: a UI responde na hora.
    setCards((atual) =>
      atual.map((c) => (c.id === cardId ? { ...c, columnId: colunaId } : c)),
    );
    try {
      await api(`/api/kanban/cards/${cardId}`, {
        method: "POST",
        json: { columnId: colunaId, position: destino },
      });
      if (quadroAtivo) await carregarQuadro(quadroAtivo);
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
      if (quadroAtivo) await carregarQuadro(quadroAtivo);
    }
  }

  async function removerCard(cardId: string) {
    if (!confirm("Remover este card do quadro?")) return;
    try {
      await api(`/api/kanban/cards/${cardId}`, { method: "DELETE" });
      setCards((atual) => atual.filter((c) => c.id !== cardId));
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  if (carregando) {
    return (
      <div className="flex gap-3 overflow-x-auto p-4 lg:p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Esqueleto key={i} className="h-96 w-72 shrink-0 rounded-xl" />
        ))}
      </div>
    );
  }

  if (erro) {
    return <EstadoErro mensagem={erro} aoTentarNovamente={() => void carregarQuadros()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--borda)] p-3 lg:px-6">
        {quadros.map((quadro) => (
          <button
            key={quadro.id}
            type="button"
            onClick={() => setQuadroAtivo(quadro.id)}
            aria-pressed={quadroAtivo === quadro.id}
            className={cn(
              "min-h-10 rounded-lg px-3 text-sm font-medium transition-colors",
              quadroAtivo === quadro.id
                ? "bg-[var(--primaria)] text-white"
                : "border border-[var(--borda)] text-[var(--texto-2)] hover:bg-[var(--superficie-2)]",
            )}
          >
            {quadro.name}
            <span className="ml-1.5 text-xs opacity-75">{quadro.cardCount}</span>
          </button>
        ))}
        <Botao
          variante="contorno"
          tamanho="pequeno"
          onClick={() => setModalQuadro(true)}
          iconeEsquerda={<Plus className="size-3.5" aria-hidden />}
        >
          Novo quadro
        </Botao>
      </div>

      {!quadroAtivo && (
        <EstadoVazio
          titulo="Nenhum quadro ainda"
          descricao="Crie quantos quadros quiser para organizar seu funil do jeito que fizer sentido para você."
          acao={<Botao onClick={() => setModalQuadro(true)}>Criar meu primeiro quadro</Botao>}
        />
      )}

      {quadroAtivo && (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 lg:p-6">
          {colunas.map((coluna) => {
            const cardsColuna = cards
              .filter((c) => c.columnId === coluna.id)
              .sort((a, b) => a.position - b.position);

            return (
              <section
                key={coluna.id}
                aria-label={coluna.name}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (arrastando) void moverCard(arrastando, coluna.id);
                  setArrastando(null);
                }}
                className="flex w-72 shrink-0 flex-col rounded-xl border border-[var(--borda)] bg-[var(--superficie)]"
              >
                <header className="flex items-center justify-between gap-2 border-b border-[var(--borda)] p-3">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: coluna.color }}
                    />
                    {coluna.name}
                  </span>
                  <span className="text-xs text-[var(--texto-2)]">
                    {cardsColuna.length}
                  </span>
                </header>

                <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {cardsColuna.length === 0 && (
                    <p className="p-3 text-center text-xs text-[var(--texto-3)]">
                      Arraste um card para cá
                    </p>
                  )}
                  {cardsColuna.map((card) => (
                    <article
                      key={card.id}
                      draggable
                      onDragStart={() => setArrastando(card.id)}
                      onDragEnd={() => setArrastando(null)}
                      className="cursor-grab rounded-lg border border-[var(--borda)] bg-[var(--fundo)] p-3 active:cursor-grabbing"
                    >
                      <p className="text-sm font-medium">{card.title}</p>
                      {card.contactName && card.contactName !== card.title && (
                        <p className="text-xs text-[var(--texto-2)]">
                          {card.contactName}
                        </p>
                      )}
                      {card.value != null && (
                        <p className="mt-1 text-xs font-semibold text-[var(--primaria)]">
                          {new Intl.NumberFormat("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          }).format(card.value)}
                        </p>
                      )}
                      {card.dueAt && (
                        <p className="mt-1 text-xs text-[var(--texto-2)]">
                          Vence em {formatarData(card.dueAt)}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {card.conversationId && (
                          <Link
                            href={`/atendimentos/${card.conversationId}`}
                            className="text-xs font-medium text-[var(--primaria)] underline"
                          >
                            Abrir conversa
                          </Link>
                        )}
                        <label className="ml-auto flex items-center gap-1 text-xs">
                          <span className="apenas-leitor-tela">Mover para</span>
                          <select
                            value={card.columnId}
                            onChange={(e) => void moverCard(card.id, e.target.value)}
                            className="rounded border border-[var(--borda)] bg-[var(--superficie)] px-1 py-0.5 text-xs"
                          >
                            {colunas.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => void removerCard(card.id)}
                          aria-label={`Remover ${card.title}`}
                          className="rounded p-1 text-[var(--texto-3)] hover:text-[var(--color-erro)]"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setModalCard(coluna.id)}
                  className="border-t border-[var(--borda)] p-2.5 text-sm font-medium text-[var(--texto-2)] hover:bg-[var(--superficie-2)]"
                >
                  <Plus className="mr-1 inline size-3.5" aria-hidden />
                  Adicionar card
                </button>
              </section>
            );
          })}
        </div>
      )}

      <ModalNovoQuadro
        aberto={modalQuadro}
        aoFechar={() => setModalQuadro(false)}
        aoSalvar={async (id) => {
          setModalQuadro(false);
          await carregarQuadros();
          setQuadroAtivo(id);
        }}
      />

      {modalCard && quadroAtivo && (
        <ModalNovoCard
          quadroId={quadroAtivo}
          colunaId={modalCard}
          aoFechar={() => setModalCard(null)}
          aoSalvar={async () => {
            setModalCard(null);
            await carregarQuadro(quadroAtivo);
          }}
        />
      )}
    </div>
  );
}

function ModalNovoQuadro({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: (id: string) => void | Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const quadro = await api<{ id: string }>("/api/kanban/boards", {
        method: "POST",
        json: { name: nome },
      });
      setNome("");
      await aoSalvar(quadro.id);
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Novo quadro"
      descricao="Cada usuário pode ter quantos quadros quiser."
      largura="estreita"
      rodape={
        <>
          <Botao variante="contorno" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} carregando={salvando}>
            Criar quadro
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo
          rotulo="Nome do quadro"
          obrigatorio
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Prospecção fria, Clientes recorrentes"
        />
        <p className="text-xs text-[var(--texto-2)]">
          As colunas padrão (Novos, Em contato, Proposta enviada, Fechado) são
          criadas automaticamente.
        </p>
      </div>
    </Modal>
  );
}

function ModalNovoCard({
  quadroId,
  colunaId,
  aoFechar,
  aoSalvar,
}: {
  quadroId: string;
  colunaId: string;
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
}) {
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await api(`/api/kanban/boards/${quadroId}`, {
        method: "POST",
        json: {
          action: "add-card",
          columnId: colunaId,
          title: titulo,
          value: valor ? Number(valor) : undefined,
        },
      });
      setTitulo("");
      setValor("");
      await aoSalvar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Novo card"
      largura="estreita"
      rodape={
        <>
          <Botao variante="contorno" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} carregando={salvando}>
            Adicionar
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo
          rotulo="Título"
          obrigatorio
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />
        <Campo
          rotulo="Valor estimado (R$)"
          type="number"
          min={0}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>
    </Modal>
  );
}
