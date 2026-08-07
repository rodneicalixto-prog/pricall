"use client";

/** Transferência de atendimento para outro vendedor ou equipe. */
import { useEffect, useState } from "react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { Aviso, Botao, AreaTexto, Modal, Selecao } from "@/components/ui";
import { ROTULOS_DISPONIBILIDADE, ROTULOS_PERFIL } from "@/lib/utils";
import type { EquipeResumo, MembroEquipe } from "./tipos";

export function ModalTransferencia({
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
  const [destino, setDestino] = useState<"vendedor" | "equipe">("vendedor");
  const [vendedorId, setVendedorId] = useState("");
  const [equipeId, setEquipeId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [vendedores, setVendedores] = useState<MembroEquipe[]>([]);
  const [equipes, setEquipes] = useState<EquipeResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    void api<{ items: MembroEquipe[] }>("/api/team/users")
      .then((d) => setVendedores(d.items.filter((u) => u.isActive)))
      .catch((e) => setErro(mensagemDeErro(e)));
    void api<{ items: EquipeResumo[] }>("/api/teams")
      .then((d) => setEquipes(d.items))
      .catch(() => {});
  }, [aberto]);

  async function transferir() {
    setErro(null);
    if (destino === "vendedor" && !vendedorId) {
      setErro("Escolha o vendedor de destino.");
      return;
    }
    if (destino === "equipe" && !equipeId) {
      setErro("Escolha a equipe de destino.");
      return;
    }

    setEnviando(true);
    try {
      await api(`/api/conversations/${conversaId}/transfer`, {
        method: "POST",
        json: {
          toUserId: destino === "vendedor" ? vendedorId : null,
          toTeamId: destino === "equipe" ? equipeId : null,
          reason: motivo.trim() || undefined,
        },
      });
      setMotivo("");
      setVendedorId("");
      setEquipeId("");
      aoConcluir();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Transferir atendimento"
      descricao="O histórico completo continua disponível para todos os envolvidos."
      largura="estreita"
      rodape={
        <>
          <Botao variante="contorno" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={transferir} carregando={enviando}>
            Confirmar transferência
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Transferir para</legend>
          <div className="flex gap-2">
            {(["vendedor", "equipe"] as const).map((opcao) => (
              <label
                key={opcao}
                className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-[var(--borda)] px-3 py-2.5 text-sm has-checked:border-[var(--primaria)] has-checked:bg-[var(--primaria)]/8"
              >
                <input
                  type="radio"
                  name="destino"
                  checked={destino === opcao}
                  onChange={() => setDestino(opcao)}
                  className="accent-[var(--primaria)]"
                />
                {opcao === "vendedor" ? "Vendedor" : "Equipe"}
              </label>
            ))}
          </div>
        </fieldset>

        {destino === "vendedor" ? (
          <Selecao
            rotulo="Vendedor de destino"
            obrigatorio
            value={vendedorId}
            onChange={(e) => setVendedorId(e.target.value)}
          >
            <option value="">Selecione…</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {ROTULOS_PERFIL[v.role]} ·{" "}
                {ROTULOS_DISPONIBILIDADE[v.availabilityStatus]} ·{" "}
                {v.activeConversations} ativo(s)
              </option>
            ))}
          </Selecao>
        ) : (
          <Selecao
            rotulo="Equipe de destino"
            obrigatorio
            value={equipeId}
            onChange={(e) => setEquipeId(e.target.value)}
          >
            <option value="">Selecione…</option>
            {equipes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Selecao>
        )}

        <AreaTexto
          rotulo="Motivo (opcional)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: cliente da carteira do João; assunto técnico."
          maxLength={500}
        />
      </div>
    </Modal>
  );
}
