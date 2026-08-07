"use client";

/** Encerramento do atendimento, com resultado e retorno programado. */
import { useState } from "react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { AreaTexto, Aviso, Botao, Campo, Modal, Selecao } from "@/components/ui";

const RESULTADOS = [
  "Cliente atendido",
  "Venda encaminhada",
  "Cliente pediu retorno",
  "Sem interesse",
  "Número incorreto",
  "Spam",
  "Outro",
];

export function ModalEncerramento({
  aberto,
  conversaId,
  aoFechar,
  aoConcluir,
}: {
  aberto: boolean;
  conversaId: string;
  aoFechar: () => void;
  aoConcluir: () => void;
}) {
  const [resultado, setResultado] = useState(RESULTADOS[0]);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [programarRetorno, setProgramarRetorno] = useState(false);
  const [dataRetorno, setDataRetorno] = useState("");
  const [notaRetorno, setNotaRetorno] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function finalizar() {
    setErro(null);
    if (!motivo.trim()) {
      setErro("Informe o motivo do encerramento.");
      return;
    }
    if (programarRetorno && !dataRetorno) {
      setErro("Informe a data e o horário do retorno.");
      return;
    }

    setEnviando(true);
    try {
      await api(`/api/conversations/${conversaId}/close`, {
        method: "POST",
        json: {
          reason: motivo.trim(),
          outcome: resultado,
          note: observacao.trim() || undefined,
          followupAt: programarRetorno
            ? new Date(dataRetorno).toISOString()
            : null,
          followupNote: notaRetorno.trim() || undefined,
        },
      });
      setMotivo("");
      setObservacao("");
      setNotaRetorno("");
      setDataRetorno("");
      setProgramarRetorno(false);
      aoConcluir();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setEnviando(false);
    }
  }

  const minimo = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Finalizar atendimento"
      descricao="Os dados informados alimentam os relatórios da empresa."
      largura="estreita"
      rodape={
        <>
          <Botao variante="contorno" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={finalizar} carregando={enviando}>
            Finalizar atendimento
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Selecao
          rotulo="Resultado do contato"
          obrigatorio
          value={resultado}
          onChange={(e) => setResultado(e.target.value)}
        >
          {RESULTADOS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Selecao>

        <Campo
          rotulo="Motivo do encerramento"
          obrigatorio
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: dúvida respondida; pedido registrado."
          maxLength={300}
        />

        <AreaTexto
          rotulo="Observação (opcional)"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          maxLength={2000}
        />

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={programarRetorno}
            onChange={(e) => setProgramarRetorno(e.target.checked)}
            className="size-4 rounded border-[var(--borda)] accent-[var(--primaria)]"
          />
          Programar retorno para este cliente
        </label>

        {programarRetorno && (
          <div className="flex flex-col gap-3 rounded-lg border border-[var(--borda)] p-3">
            <Campo
              rotulo="Data e horário do retorno"
              type="datetime-local"
              obrigatorio
              min={minimo}
              value={dataRetorno}
              onChange={(e) => setDataRetorno(e.target.value)}
            />
            <Campo
              rotulo="Anotação do retorno"
              value={notaRetorno}
              onChange={(e) => setNotaRetorno(e.target.value)}
              placeholder="Ex.: retornar com o orçamento revisado."
              maxLength={500}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
