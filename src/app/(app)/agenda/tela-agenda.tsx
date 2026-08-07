"use client";

/** Agenda do vendedor: compromissos do mês e retornos programados. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { cn, formatarData, formatarHora } from "@/lib/utils";
import {
  AreaTexto,
  Aviso,
  Botao,
  Campo,
  Cartao,
  Esqueleto,
  EstadoErro,
  EstadoVazio,
  Etiqueta,
  Modal,
  useToast,
} from "@/components/ui";

type Compromisso = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  conversationId: string | null;
  contactName: string | null;
};

type Retorno = {
  id: string;
  conversationId: string;
  scheduledAt: string;
  note: string | null;
  status: string;
  contactName: string | null;
};

export function TelaAgenda() {
  const toast = useToast();
  const [mes, setMes] = useState(() => {
    const hoje = new Date();
    return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  });
  const [compromissos, setCompromissos] = useState<Compromisso[]>([]);
  const [retornos, setRetornos] = useState<Retorno[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modalNovo, setModalNovo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1);
      const fim = new Date(mes.getFullYear(), mes.getMonth() + 1, 0, 23, 59, 59);
      const params = new URLSearchParams({
        from: inicio.toISOString(),
        to: fim.toISOString(),
        includeFollowups: "true",
      });
      const dados = await api<{
        events: Compromisso[];
        followups: Retorno[];
        pendingFollowups: Retorno[];
      }>(`/api/calendar?${params}`);
      setCompromissos(dados.events);
      setRetornos(dados.pendingFollowups);
      setErro(null);
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function concluirRetorno(id: string) {
    try {
      await api("/api/calendar", {
        method: "POST",
        json: { action: "complete-followup", followupId: id },
      });
      toast.mostrar("sucesso", "Retorno marcado como concluído.");
      await carregar();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  const nomeMes = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(mes);

  const porDia = new Map<string, Compromisso[]>();
  for (const item of compromissos) {
    const chave = item.startsAt.slice(0, 10);
    porDia.set(chave, [...(porDia.get(chave) ?? []), item]);
  }

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Botao
            variante="contorno"
            tamanho="pequeno"
            aria-label="Mês anterior"
            onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Botao>
          <h2 className="min-w-40 text-center text-sm font-semibold capitalize">
            {nomeMes}
          </h2>
          <Botao
            variante="contorno"
            tamanho="pequeno"
            aria-label="Próximo mês"
            onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Botao>
        </div>
        <Botao
          onClick={() => setModalNovo(true)}
          iconeEsquerda={<CalendarPlus className="size-4" aria-hidden />}
        >
          Novo compromisso
        </Botao>
      </div>

      {retornos.length > 0 && (
        <Cartao>
          <h2 className="mb-3 text-sm font-semibold">
            Retornos programados ({retornos.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {retornos.map((retorno) => {
              const atrasado = new Date(retorno.scheduledAt) < new Date();
              return (
                <li
                  key={retorno.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--borda)] p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {retorno.contactName ?? "Cliente"}
                    </p>
                    <p className="text-xs text-[var(--texto-2)]">
                      {formatarData(retorno.scheduledAt)} às{" "}
                      {formatarHora(retorno.scheduledAt)}
                      {retorno.note && ` · ${retorno.note}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {atrasado && <Etiqueta cor="#DC2626">Atrasado</Etiqueta>}
                    <Link
                      href={`/atendimentos/${retorno.conversationId}`}
                      className="text-xs font-medium text-[var(--primaria)] underline"
                    >
                      Abrir conversa
                    </Link>
                    <Botao
                      variante="contorno"
                      tamanho="pequeno"
                      onClick={() => void concluirRetorno(retorno.id)}
                      iconeEsquerda={<Check className="size-3.5" aria-hidden />}
                    >
                      Concluir
                    </Botao>
                  </div>
                </li>
              );
            })}
          </ul>
        </Cartao>
      )}

      {carregando && <Esqueleto className="h-64 rounded-xl" />}
      {!carregando && erro && (
        <EstadoErro mensagem={erro} aoTentarNovamente={() => void carregar()} />
      )}

      {!carregando && !erro && (
        <Cartao>
          <h2 className="mb-3 text-sm font-semibold">Compromissos do mês</h2>
          {compromissos.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum compromisso agendado"
              descricao="Crie um compromisso para não perder visitas, ligações e reuniões."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {[...porDia.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([dia, itens]) => (
                  <li key={dia}>
                    <p className="mb-1.5 text-xs font-semibold text-[var(--texto-2)]">
                      {formatarData(`${dia}T12:00:00`)}
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {itens.map((item) => (
                        <li
                          key={item.id}
                          className={cn(
                            "rounded-lg border border-[var(--borda)] p-3",
                            item.status === "cancelled" && "opacity-55",
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">{item.title}</p>
                            <span className="text-xs text-[var(--texto-2)]">
                              {formatarHora(item.startsAt)} –{" "}
                              {formatarHora(item.endsAt)}
                            </span>
                          </div>
                          {(item.contactName || item.location) && (
                            <p className="mt-0.5 text-xs text-[var(--texto-2)]">
                              {[item.contactName, item.location]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                          {item.conversationId && (
                            <Link
                              href={`/atendimentos/${item.conversationId}`}
                              className="mt-1 inline-block text-xs font-medium text-[var(--primaria)] underline"
                            >
                              Abrir conversa
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          )}
        </Cartao>
      )}

      <ModalNovoCompromisso
        aberto={modalNovo}
        aoFechar={() => setModalNovo(false)}
        aoSalvar={async () => {
          setModalNovo(false);
          await carregar();
        }}
      />
    </div>
  );
}

function ModalNovoCompromisso({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [local, setLocal] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    if (!titulo.trim() || !inicio || !fim) {
      setErro("Informe título, início e término.");
      return;
    }
    setSalvando(true);
    try {
      await api("/api/calendar", {
        method: "POST",
        json: {
          action: "create-event",
          title: titulo,
          description: descricao || undefined,
          location: local || undefined,
          startsAt: new Date(inicio).toISOString(),
          endsAt: new Date(fim).toISOString(),
        },
      });
      setTitulo("");
      setDescricao("");
      setLocal("");
      setInicio("");
      setFim("");
      await aoSalvar();
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
      titulo="Novo compromisso"
      largura="estreita"
      rodape={
        <>
          <Botao variante="contorno" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} carregando={salvando}>
            Agendar
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            rotulo="Início"
            type="datetime-local"
            obrigatorio
            value={inicio}
            onChange={(e) => {
              setInicio(e.target.value);
              if (!fim && e.target.value) {
                const proximo = new Date(e.target.value);
                proximo.setHours(proximo.getHours() + 1);
                setFim(
                  new Date(proximo.getTime() - proximo.getTimezoneOffset() * 60000)
                    .toISOString()
                    .slice(0, 16),
                );
              }
            }}
          />
          <Campo
            rotulo="Término"
            type="datetime-local"
            obrigatorio
            value={fim}
            onChange={(e) => setFim(e.target.value)}
          />
        </div>
        <Campo
          rotulo="Local"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
        />
        <AreaTexto
          rotulo="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </div>
    </Modal>
  );
}
