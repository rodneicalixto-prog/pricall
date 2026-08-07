"use client";

/**
 * Central de atendimento.
 *
 * Desktop: três colunas (filas · lista · conversa) com painel do cliente
 * deslizante. Mobile: a lista ocupa a tela e a conversa abre por cima,
 * com botão de voltar — o mesmo componente atende os dois formatos.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Filter, Inbox, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Botao, EstadoVazio, Etiqueta } from "@/components/ui";
import { useSessao } from "@/components/app/sessao";
import { CabecalhoApp } from "@/components/app/navegacao";
import { ListaConversas, type FiltrosLista } from "./lista-conversas";
import { PainelConversa } from "./painel-conversa";
import { PainelDadosContato } from "./painel-contato";
import { PainelDemonstracao } from "./painel-demonstracao";
import {
  FILAS,
  type ChaveFila,
  type DetalheConversa,
  type EquipeResumo,
  type Marcador,
  type MembroEquipe,
} from "./tipos";

export function CentralAtendimento({
  conversaInicial,
}: {
  conversaInicial?: string;
}) {
  const router = useRouter();
  const { organizacao, pode } = useSessao();

  const [filtros, setFiltros] = useState<FiltrosLista>({
    fila: "all",
    busca: "",
  });
  const [selecionada, setSelecionada] = useState<string | null>(
    conversaInicial ?? null,
  );
  const [detalhe, setDetalhe] = useState<DetalheConversa | null>(null);
  const [painelContato, setPainelContato] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [revalidacao, setRevalidacao] = useState(0);

  const [vendedores, setVendedores] = useState<MembroEquipe[]>([]);
  const [equipes, setEquipes] = useState<EquipeResumo[]>([]);
  const [marcadores, setMarcadores] = useState<Marcador[]>([]);

  useEffect(() => {
    if (pode("users.view")) {
      void api<{ items: MembroEquipe[] }>("/api/team/users")
        .then((d) => setVendedores(d.items))
        .catch(() => {});
    }
    void api<{ items: EquipeResumo[] }>("/api/teams")
      .then((d) => setEquipes(d.items))
      .catch(() => {});
    void api<{ items: Marcador[] }>("/api/tags")
      .then((d) => setMarcadores(d.items))
      .catch(() => {});
  }, [pode]);

  // Mantém os dados do painel do cliente em sincronia com a conversa aberta.
  const recarregarDetalhe = useCallback(async () => {
    if (!selecionada) {
      setDetalhe(null);
      return;
    }
    try {
      setDetalhe(await api<DetalheConversa>(`/api/conversations/${selecionada}`));
    } catch {
      setDetalhe(null);
    }
  }, [selecionada]);

  useEffect(() => {
    void recarregarDetalhe();
  }, [recarregarDetalhe, revalidacao]);

  const selecionar = (id: string) => {
    setSelecionada(id);
    setPainelContato(false);
    // Mantém a URL compartilhável sem recarregar a árvore de componentes.
    window.history.replaceState(null, "", `/atendimentos/${id}`);
  };

  const voltar = () => {
    setSelecionada(null);
    setDetalhe(null);
    window.history.replaceState(null, "", "/atendimentos");
  };

  const filtrosAtivos =
    (filtros.vendedorId ? 1 : 0) +
    (filtros.equipeId ? 1 : 0) +
    (filtros.marcadorId ? 1 : 0) +
    (filtros.de ? 1 : 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn(selecionada && "hidden lg:block")}>
        <CabecalhoApp titulo={organizacao.inboxName} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Coluna 1 — filas e filtros (desktop) */}
        <nav
          className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-[var(--borda)] bg-[var(--superficie)] p-3 xl:flex"
          aria-label="Filas de atendimento"
        >
          <ListaFilas
            fila={filtros.fila}
            aoSelecionar={(fila) => setFiltros((f) => ({ ...f, fila }))}
          />
          <div className="mt-4 border-t border-[var(--borda)] pt-4">
            <FormularioFiltros
              filtros={filtros}
              vendedores={vendedores}
              equipes={equipes}
              marcadores={marcadores}
              podeFiltrarVendedor={pode("users.view")}
              aoAlterar={(parcial) => setFiltros((f) => ({ ...f, ...parcial }))}
            />
          </div>
          {organizacao.demoMode && (
            <div className="mt-4 border-t border-[var(--borda)] pt-4">
              <PainelDemonstracao aoSimular={() => setRevalidacao((n) => n + 1)} />
            </div>
          )}
        </nav>

        {/* Coluna 2 — lista */}
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col border-r border-[var(--borda)] bg-[var(--superficie)] lg:max-w-96",
            selecionada && "hidden lg:flex",
          )}
        >
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--borda)] p-2 xl:hidden">
            <button
              type="button"
              onClick={() => setFiltrosAbertos(true)}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--borda)] px-3 text-xs font-medium"
              aria-label="Abrir filtros"
            >
              <Filter className="size-3.5" aria-hidden />
              Filtros
              {filtrosAtivos > 0 && (
                <span className="rounded-full bg-[var(--primaria)] px-1.5 text-[10px] text-white">
                  {filtrosAtivos}
                </span>
              )}
            </button>
            {FILAS.map((item) => (
              <button
                key={item.chave}
                type="button"
                onClick={() => setFiltros((f) => ({ ...f, fila: item.chave }))}
                aria-pressed={filtros.fila === item.chave}
                className={cn(
                  "min-h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                  filtros.fila === item.chave
                    ? "border-[var(--primaria)] bg-[var(--primaria)] text-white"
                    : "border-[var(--borda)] text-[var(--texto-2)]",
                )}
              >
                {item.rotulo}
              </button>
            ))}
          </div>

          <ListaConversas
            key={revalidacao}
            filtros={filtros}
            conversaSelecionada={selecionada}
            aoSelecionar={selecionar}
            aoMudarBusca={(busca) => setFiltros((f) => ({ ...f, busca }))}
          />
        </div>

        {/* Coluna 3 — conversa */}
        <div className={cn("flex min-w-0 flex-1", !selecionada && "hidden lg:flex")}>
          {selecionada ? (
            <PainelConversa
              conversaId={selecionada}
              aoVoltar={voltar}
              aoAbrirContato={() => setPainelContato(true)}
              aoMudar={() => setRevalidacao((n) => n + 1)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EstadoVazio
                icone={<Inbox className="size-10" aria-hidden />}
                titulo="Selecione um atendimento"
                descricao="Escolha uma conversa na lista para ver o histórico e responder o cliente."
              />
            </div>
          )}
        </div>

        {/* Painel do cliente */}
        {painelContato && selecionada && (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/40 lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:bg-transparent">
            <div className="flex w-full max-w-sm flex-col border-l border-[var(--borda)] bg-[var(--superficie)] lg:max-w-none">
              <PainelDadosContato
                conversaId={selecionada}
                detalhe={detalhe}
                aoFechar={() => setPainelContato(false)}
                aoAtualizar={() => setRevalidacao((n) => n + 1)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Filtros em tela cheia no mobile */}
      {filtrosAbertos && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--superficie)] xl:hidden">
          <header className="flex items-center justify-between border-b border-[var(--borda)] p-4">
            <h2 className="font-semibold">Filtros</h2>
            <button
              type="button"
              onClick={() => setFiltrosAbertos(false)}
              aria-label="Fechar filtros"
              className="rounded-lg p-2 hover:bg-[var(--superficie-2)]"
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-4">
            <ListaFilas
              fila={filtros.fila}
              aoSelecionar={(fila) => setFiltros((f) => ({ ...f, fila }))}
            />
            <div className="mt-6">
              <FormularioFiltros
                filtros={filtros}
                vendedores={vendedores}
                equipes={equipes}
                marcadores={marcadores}
                podeFiltrarVendedor={pode("users.view")}
                aoAlterar={(parcial) => setFiltros((f) => ({ ...f, ...parcial }))}
              />
            </div>
            {organizacao.demoMode && (
              <div className="mt-6 border-t border-[var(--borda)] pt-4">
                <PainelDemonstracao
                  aoSimular={() => setRevalidacao((n) => n + 1)}
                />
              </div>
            )}
          </div>
          <footer className="border-t border-[var(--borda)] p-4">
            <Botao className="w-full" onClick={() => setFiltrosAbertos(false)}>
              Aplicar filtros
            </Botao>
          </footer>
        </div>
      )}
    </div>
  );
}

function ListaFilas({
  fila,
  aoSelecionar,
}: {
  fila: ChaveFila;
  aoSelecionar: (fila: ChaveFila) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {FILAS.map((item) => (
        <li key={item.chave}>
          <button
            type="button"
            onClick={() => aoSelecionar(item.chave)}
            aria-current={fila === item.chave ? "true" : undefined}
            className={cn(
              "flex min-h-10 w-full items-center rounded-lg px-3 text-sm font-medium transition-colors",
              fila === item.chave
                ? "bg-[var(--primaria)]/12 text-[var(--primaria)]"
                : "text-[var(--texto-2)] hover:bg-[var(--superficie-2)]",
            )}
          >
            {item.rotulo}
          </button>
        </li>
      ))}
    </ul>
  );
}

function FormularioFiltros({
  filtros,
  vendedores,
  equipes,
  marcadores,
  podeFiltrarVendedor,
  aoAlterar,
}: {
  filtros: FiltrosLista;
  vendedores: MembroEquipe[];
  equipes: EquipeResumo[];
  marcadores: Marcador[];
  podeFiltrarVendedor: boolean;
  aoAlterar: (parcial: Partial<FiltrosLista>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold tracking-wide text-[var(--texto-2)] uppercase">
        Refinar
      </p>

      {podeFiltrarVendedor && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--texto-2)]">Vendedor</span>
          <select
            value={filtros.vendedorId ?? ""}
            onChange={(e) => aoAlterar({ vendedorId: e.target.value || undefined })}
            className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
          >
            <option value="">Todos</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--texto-2)]">Equipe</span>
        <select
          value={filtros.equipeId ?? ""}
          onChange={(e) => aoAlterar({ equipeId: e.target.value || undefined })}
          className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
        >
          <option value="">Todas</option>
          {equipes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--texto-2)]">Marcador</span>
        <select
          value={filtros.marcadorId ?? ""}
          onChange={(e) => aoAlterar({ marcadorId: e.target.value || undefined })}
          className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
        >
          <option value="">Todos</option>
          {marcadores.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--texto-2)]">A partir de</span>
        <input
          type="date"
          value={filtros.de?.slice(0, 10) ?? ""}
          onChange={(e) =>
            aoAlterar({
              de: e.target.value
                ? new Date(`${e.target.value}T00:00:00`).toISOString()
                : undefined,
            })
          }
          className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
        />
      </label>

      {(filtros.vendedorId ||
        filtros.equipeId ||
        filtros.marcadorId ||
        filtros.de) && (
        <button
          type="button"
          onClick={() =>
            aoAlterar({
              vendedorId: undefined,
              equipeId: undefined,
              marcadorId: undefined,
              de: undefined,
              ate: undefined,
            })
          }
          className="self-start text-xs font-medium text-[var(--primaria)] underline"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}

export { Etiqueta };
