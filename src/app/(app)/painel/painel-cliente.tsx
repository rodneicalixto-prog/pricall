"use client";

/** Painel gerencial: indicadores, gráfico dos últimos 7 dias e alertas. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Inbox,
  MessageSquareDashed,
  Settings,
  Timer,
  UserCheck,
  Users,
} from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { cn, formatarDuracao, formatarMinutos } from "@/lib/utils";
import {
  Cartao,
  Esqueleto,
  EstadoErro,
  EstadoVazio,
  Etiqueta,
} from "@/components/ui";
import { useSessao } from "@/components/app/sessao";
import { useEventoTempoReal } from "@/components/app/tempo-real";

type Painel = {
  counters: {
    waiting: number;
    inProgress: number;
    waitingCustomer: number;
    unanswered: number;
    closedToday: number;
    unassigned: number;
    onlineSellers: number;
  };
  averages: {
    firstResponseSeconds: number | null;
    handleTimeSeconds: number | null;
  };
  perSeller: { userId: string | null; userName: string; total: number }[];
  lastSevenDays: { date: string; received: number; closed: number }[];
  stalled: {
    id: string;
    contactName: string;
    assignedUserName: string | null;
    minutes: number;
    priority: string;
  }[];
  slaStaleMinutes: number;
};

const EVENTOS = [
  "conversation.created",
  "conversation.updated",
  "conversation.closed",
  "conversation.assigned",
];

export function PainelCliente() {
  const { usuario, pode } = useSessao();
  const [dados, setDados] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      setDados(await api<Painel>("/api/dashboard"));
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

  useEventoTempoReal(EVENTOS, () => void carregar(true));

  if (carregando) {
    return (
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:p-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Esqueleto key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <EstadoErro
        mensagem={erro ?? "Não foi possível carregar o painel."}
        aoTentarNovamente={() => void carregar()}
      />
    );
  }

  const escopo =
    usuario.role === "admin"
      ? "toda a empresa"
      : usuario.role === "supervisor"
        ? "as equipes que você supervisiona"
        : "seus atendimentos";

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-4 lg:p-6">
      <p className="text-sm text-[var(--texto-2)]">
        Indicadores de <strong>{escopo}</strong>.
      </p>

      <section
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Indicadores principais"
      >
        <Indicador
          rotulo="Aguardando atendimento"
          valor={dados.counters.waiting}
          Icone={Inbox}
          cor="#F59E0B"
          destaque={dados.counters.waiting > 0}
          href="/atendimentos"
        />
        <Indicador
          rotulo="Em andamento"
          valor={dados.counters.inProgress}
          Icone={MessageSquareDashed}
          cor="#16A34A"
          href="/atendimentos"
        />
        <Indicador
          rotulo="Sem resposta"
          valor={dados.counters.unanswered}
          Icone={AlertTriangle}
          cor="#DC2626"
          destaque={dados.counters.unanswered > 0}
          href="/atendimentos"
        />
        <Indicador
          rotulo="Finalizados hoje"
          valor={dados.counters.closedToday}
          Icone={CheckCircle2}
          cor="#2563EB"
        />
        <Indicador
          rotulo="Tempo médio 1ª resposta"
          valor={formatarDuracao(dados.averages.firstResponseSeconds)}
          Icone={Timer}
          cor="#7C3AED"
        />
        <Indicador
          rotulo="Tempo médio de atendimento"
          valor={formatarDuracao(dados.averages.handleTimeSeconds)}
          Icone={Clock3}
          cor="#0EA5E9"
        />
        <Indicador
          rotulo="Vendedores online"
          valor={dados.counters.onlineSellers}
          Icone={Users}
          cor="#16A34A"
          href={pode("users.view") ? "/equipe" : undefined}
        />
        <Indicador
          rotulo="Sem responsável"
          valor={dados.counters.unassigned}
          Icone={UserCheck}
          cor="#64748B"
          destaque={dados.counters.unassigned > 0}
          href="/atendimentos"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Últimos sete dias</h2>
          <GraficoSemana dados={dados.lastSevenDays} />
        </Cartao>

        <Cartao>
          <h2 className="mb-3 text-sm font-semibold">Conversas por vendedor</h2>
          {dados.perSeller.length === 0 ? (
            <p className="text-sm text-[var(--texto-2)]">
              Nenhuma conversa ativa no momento.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dados.perSeller.map((item) => {
                const maximo = Math.max(...dados.perSeller.map((s) => s.total), 1);
                return (
                  <li key={item.userId ?? "sem"} className="flex flex-col gap-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{item.userName}</span>
                      <span className="font-semibold">{item.total}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--superficie-2)]">
                      <div
                        className="h-full rounded-full bg-[var(--primaria)]"
                        style={{ width: `${(item.total / maximo) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>
      </div>

      <Cartao>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle
            className="size-4 text-[var(--color-alerta)]"
            aria-hidden
          />
          Conversas paradas há mais de {formatarMinutos(dados.slaStaleMinutes)}
        </h2>
        {dados.stalled.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma conversa parada"
            descricao="Todos os clientes com mensagem pendente foram respondidos dentro do prazo."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {dados.stalled.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/atendimentos/${item.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--borda)] p-3 transition-colors hover:bg-[var(--superficie-2)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {item.contactName}
                    </p>
                    <p className="truncate text-xs text-[var(--texto-2)]">
                      {item.assignedUserName ?? "Sem responsável"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Etiqueta cor="#DC2626">
                      {formatarMinutos(item.minutes)}
                    </Etiqueta>
                    <ArrowRight
                      className="size-4 text-[var(--texto-3)]"
                      aria-hidden
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Atalhos">
        <Atalho href="/atendimentos" rotulo="Caixa de entrada" Icone={Inbox} />
        {pode("users.view") && (
          <Atalho href="/equipe" rotulo="Equipe" Icone={Users} />
        )}
        <Atalho href="/configuracoes" rotulo="Configurações" Icone={Settings} />
      </section>
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  Icone,
  cor,
  destaque,
  href,
}: {
  rotulo: string;
  valor: number | string;
  Icone: typeof Inbox;
  cor: string;
  destaque?: boolean;
  href?: string;
}) {
  const conteudo = (
    <div
      className={cn(
        "flex h-full flex-col gap-2 rounded-xl border bg-[var(--superficie)] p-4 transition-colors",
        destaque ? "border-current" : "border-[var(--borda)]",
        href && "hover:bg-[var(--superficie-2)]",
      )}
      style={destaque ? { borderColor: `${cor}66` } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--texto-2)]">{rotulo}</span>
        <Icone className="size-4 shrink-0" style={{ color: cor }} aria-hidden />
      </div>
      <span className="text-2xl font-bold tabular-nums">{valor}</span>
    </div>
  );

  return href ? <Link href={href}>{conteudo}</Link> : conteudo;
}

function Atalho({
  href,
  rotulo,
  Icone,
}: {
  href: string;
  rotulo: string;
  Icone: typeof Inbox;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--borda)] bg-[var(--superficie)] px-4 text-sm font-medium transition-colors hover:bg-[var(--superficie-2)]"
    >
      <Icone className="size-4 text-[var(--primaria)]" aria-hidden />
      {rotulo}
      <ArrowRight className="ml-auto size-4 text-[var(--texto-3)]" aria-hidden />
    </Link>
  );
}

/** Gráfico de barras em SVG — sem biblioteca externa e acessível por tabela. */
function GraficoSemana({
  dados,
}: {
  dados: { date: string; received: number; closed: number }[];
}) {
  const maximo = Math.max(...dados.flatMap((d) => [d.received, d.closed]), 1);
  const larguraGrupo = 100 / Math.max(dados.length, 1);

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--primaria)]" />
          Recebidos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--color-informacao)]" />
          Finalizados
        </span>
      </div>

      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label="Gráfico de conversas recebidas e finalizadas nos últimos sete dias"
      >
        {dados.map((dia, indice) => {
          const x = indice * larguraGrupo;
          const alturaRecebidas = (dia.received / maximo) * 34;
          const alturaFinalizadas = (dia.closed / maximo) * 34;
          const largura = larguraGrupo * 0.32;
          return (
            <g key={dia.date}>
              <rect
                x={x + larguraGrupo * 0.14}
                y={36 - alturaRecebidas}
                width={largura}
                height={Math.max(alturaRecebidas, 0.4)}
                rx="0.6"
                fill="var(--primaria)"
              />
              <rect
                x={x + larguraGrupo * 0.52}
                y={36 - alturaFinalizadas}
                width={largura}
                height={Math.max(alturaFinalizadas, 0.4)}
                rx="0.6"
                fill="#2563EB"
              />
            </g>
          );
        })}
        <line x1="0" y1="36" x2="100" y2="36" stroke="var(--borda)" strokeWidth="0.3" />
      </svg>

      <div className="mt-1 flex text-[10px] text-[var(--texto-3)]">
        {dados.map((dia) => (
          <span key={dia.date} className="flex-1 text-center">
            {new Date(`${dia.date}T12:00:00`).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
            })}
          </span>
        ))}
      </div>

      {/* Alternativa textual para leitores de tela. */}
      <table className="apenas-leitor-tela">
        <caption>Conversas recebidas e finalizadas por dia</caption>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Recebidas</th>
            <th>Finalizadas</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((dia) => (
            <tr key={dia.date}>
              <td>{dia.date}</td>
              <td>{dia.received}</td>
              <td>{dia.closed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
