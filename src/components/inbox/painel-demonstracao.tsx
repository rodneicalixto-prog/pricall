"use client";

/**
 * Simulador do modo demonstração: gera mensagens recebidas para testar a
 * central sem nenhuma credencial externa.
 */
import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { Botao, useToast } from "@/components/ui";

const EXEMPLOS = [
  "Bom dia! Vocês têm esse produto em estoque?",
  "Consigo um orçamento para 50 unidades?",
  "Meu pedido já saiu para entrega?",
  "Preciso de ajuda urgente, o produto chegou com defeito.",
  "Qual o prazo de entrega para o interior?",
];

export function PainelDemonstracao({ aoSimular }: { aoSimular?: () => void }) {
  const toast = useToast();
  const [texto, setTexto] = useState(EXEMPLOS[0]);
  const [enviando, setEnviando] = useState(false);

  async function simular() {
    setEnviando(true);
    try {
      await api("/api/webhooks/demo", {
        method: "POST",
        json: { action: "incoming", text: texto },
      });
      toast.mostrar("sucesso", "Mensagem simulada recebida na central.");
      aoSimular?.();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-wide text-[var(--texto-2)] uppercase">
        Simulador
      </p>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--texto-2)]">Mensagem do cliente</span>
        <select
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
        >
          {EXEMPLOS.map((exemplo) => (
            <option key={exemplo} value={exemplo}>
              {exemplo}
            </option>
          ))}
        </select>
      </label>
      <Botao
        variante="contorno"
        tamanho="pequeno"
        carregando={enviando}
        onClick={simular}
        iconeEsquerda={<PlayCircle className="size-3.5" aria-hidden />}
      >
        Simular mensagem recebida
      </Botao>
    </div>
  );
}
