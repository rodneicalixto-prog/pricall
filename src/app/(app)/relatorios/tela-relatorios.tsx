"use client";

/** Relatórios com filtros, exportação e importação em CSV. */
import { useCallback, useEffect, useState } from "react";
import { Download, Upload } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { formatarDuracao } from "@/lib/utils";
import {
  Aviso,
  Botao,
  Cartao,
  Esqueleto,
  EstadoErro,
  useToast,
} from "@/components/ui";
import { useSessao } from "@/components/app/sessao";

type Relatorio = {
  totals: {
    received: number;
    closed: number;
    unanswered: number;
    uniqueContacts: number;
    transfers: number;
    transferRate: number;
    averageFirstResponseSeconds: number | null;
    averageCloseTimeSeconds: number | null;
  };
  bySeller: {
    userId: string | null;
    userName: string;
    total: number;
    closed: number;
    averageFirstResponseSeconds: number | null;
  }[];
  byTeam: { teamId: string | null; teamName: string; total: number; closed: number }[];
  byHour: { hour: number; total: number }[];
  byOutcome: { outcome: string; reason: string; total: number }[];
  daily: { date: string; total: number }[];
};

function inicioMesAtual() {
  const data = new Date();
  data.setDate(1);
  data.setHours(0, 0, 0, 0);
  return data.toISOString().slice(0, 10);
}

export function TelaRelatorios() {
  const { pode } = useSessao();
  const toast = useToast();

  const [de, setDe] = useState(inicioMesAtual());
  const [ate, setAte] = useState(new Date().toISOString().slice(0, 10));
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams({
        from: new Date(`${de}T00:00:00`).toISOString(),
        to: new Date(`${ate}T23:59:59`).toISOString(),
      });
      setDados(await api<Relatorio>(`/api/reports?${params}`));
      setErro(null);
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function exportar() {
    const params = new URLSearchParams({
      from: new Date(`${de}T00:00:00`).toISOString(),
      to: new Date(`${ate}T23:59:59`).toISOString(),
    });
    window.location.href = `/api/reports/export?${params}`;
  }

  async function importar(arquivo: File) {
    setImportando(true);
    setResultadoImportacao(null);
    try {
      const formulario = new FormData();
      formulario.append("file", arquivo);
      const resultado = await api<{
        processed: number;
        created: number;
        updated: number;
        skipped: { line: number; reason: string }[];
      }>("/api/reports/import", { method: "POST", body: formulario });

      setResultadoImportacao(
        `${resultado.processed} linha(s) processada(s): ${resultado.created} contato(s) criado(s), ${resultado.updated} atualizado(s), ${resultado.skipped.length} ignorado(s).`,
      );
      toast.mostrar("sucesso", "Importação concluída.");
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-4 lg:p-6">
      <Cartao>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">De</span>
            <input
              type="date"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="min-h-11 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Até</span>
            <input
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="min-h-11 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-3 text-sm"
            />
          </label>

          {pode("reports.export") && (
            <Botao
              variante="contorno"
              onClick={exportar}
              iconeEsquerda={<Download className="size-4" aria-hidden />}
            >
              Exportar CSV
            </Botao>
          )}

          {pode("reports.import") && (
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--borda)] px-4 text-sm font-medium hover:bg-[var(--superficie-2)]">
              <Upload className="size-4" aria-hidden />
              {importando ? "Importando…" : "Importar contatos (CSV)"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={importando}
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) void importar(arquivo);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        {resultadoImportacao && (
          <div className="mt-3">
            <Aviso tipo="sucesso">{resultadoImportacao}</Aviso>
          </div>
        )}
        {pode("reports.import") && (
          <p className="mt-2 text-xs text-[var(--texto-2)]">
            O CSV precisa ter cabeçalho com a coluna <code>telefone</code>.
            Colunas opcionais: nome, email, empresa, cidade, origem, observacoes.
          </p>
        )}
      </Cartao>

      {carregando && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Esqueleto key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {!carregando && erro && (
        <EstadoErro mensagem={erro} aoTentarNovamente={() => void carregar()} />
      )}

      {!carregando && !erro && dados && (
        <>
          <section
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            aria-label="Totais do período"
          >
            <Total rotulo="Atendimentos recebidos" valor={dados.totals.received} />
            <Total rotulo="Atendimentos finalizados" valor={dados.totals.closed} />
            <Total rotulo="Conversas não respondidas" valor={dados.totals.unanswered} />
            <Total rotulo="Clientes únicos" valor={dados.totals.uniqueContacts} />
            <Total
              rotulo="Tempo médio 1ª resposta"
              valor={formatarDuracao(dados.totals.averageFirstResponseSeconds)}
            />
            <Total
              rotulo="Tempo médio até encerrar"
              valor={formatarDuracao(dados.totals.averageCloseTimeSeconds)}
            />
            <Total rotulo="Transferências" valor={dados.totals.transfers} />
            <Total
              rotulo="Taxa de transferência"
              valor={`${(dados.totals.transferRate * 100).toFixed(1)}%`}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tabela
              titulo="Atendimentos por vendedor"
              colunas={["Vendedor", "Total", "Finalizados", "1ª resposta"]}
              linhas={dados.bySeller.map((s) => [
                s.userName,
                String(s.total),
                String(s.closed),
                formatarDuracao(s.averageFirstResponseSeconds),
              ])}
            />
            <Tabela
              titulo="Atendimentos por equipe"
              colunas={["Equipe", "Total", "Finalizados"]}
              linhas={dados.byTeam.map((t) => [
                t.teamName,
                String(t.total),
                String(t.closed),
              ])}
            />
            <Tabela
              titulo="Motivos de encerramento"
              colunas={["Resultado", "Motivo", "Total"]}
              linhas={dados.byOutcome.map((o) => [o.outcome, o.reason, String(o.total)])}
            />
            <Cartao>
              <h2 className="mb-3 text-sm font-semibold">
                Atendimentos por horário
              </h2>
              <GraficoHoras dados={dados.byHour} />
            </Cartao>
          </div>

          <Cartao>
            <h2 className="mb-3 text-sm font-semibold">Evolução diária</h2>
            <GraficoDiario dados={dados.daily} />
          </Cartao>
        </>
      )}
    </div>
  );
}

function Total({ rotulo, valor }: { rotulo: string; valor: number | string }) {
  return (
    <Cartao>
      <p className="text-xs font-medium text-[var(--texto-2)]">{rotulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
    </Cartao>
  );
}

function Tabela({
  titulo,
  colunas,
  linhas,
}: {
  titulo: string;
  colunas: string[];
  linhas: string[][];
}) {
  return (
    <Cartao>
      <h2 className="mb-3 text-sm font-semibold">{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="text-sm text-[var(--texto-2)]">
          Nenhum dado no período selecionado.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--borda)] text-left">
                {colunas.map((coluna) => (
                  <th key={coluna} className="pb-2 font-medium text-[var(--texto-2)]">
                    {coluna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha, indice) => (
                <tr key={indice} className="border-b border-[var(--borda)] last:border-0">
                  {linha.map((celula, coluna) => (
                    <td key={coluna} className="py-2">
                      {celula}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Cartao>
  );
}

function GraficoHoras({ dados }: { dados: { hour: number; total: number }[] }) {
  const porHora = Array.from({ length: 24 }, (_, hora) => ({
    hora,
    total: dados.find((d) => d.hour === hora)?.total ?? 0,
  }));
  const maximo = Math.max(...porHora.map((h) => h.total), 1);

  return (
    <div className="flex h-32 items-end gap-0.5">
      {porHora.map((item) => (
        <div key={item.hora} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-[var(--primaria)]"
            style={{ height: `${(item.total / maximo) * 100}%`, minHeight: "2px" }}
            title={`${item.hora}h: ${item.total} atendimento(s)`}
          />
          {item.hora % 6 === 0 && (
            <span className="text-[9px] text-[var(--texto-3)]">{item.hora}h</span>
          )}
        </div>
      ))}
    </div>
  );
}

function GraficoDiario({ dados }: { dados: { date: string; total: number }[] }) {
  if (dados.length === 0) {
    return (
      <p className="text-sm text-[var(--texto-2)]">
        Nenhum atendimento no período selecionado.
      </p>
    );
  }
  const maximo = Math.max(...dados.map((d) => d.total), 1);

  return (
    <div className="flex h-32 items-end gap-1 overflow-x-auto">
      {dados.map((dia) => (
        <div key={dia.date} className="flex min-w-6 flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-[var(--color-informacao)]"
            style={{ height: `${(dia.total / maximo) * 100}%`, minHeight: "2px" }}
            title={`${dia.date}: ${dia.total}`}
          />
          <span className="text-[9px] whitespace-nowrap text-[var(--texto-3)]">
            {dia.date.slice(8, 10)}/{dia.date.slice(5, 7)}
          </span>
        </div>
      ))}
    </div>
  );
}
