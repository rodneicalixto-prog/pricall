"use client";

/**
 * Agenda de contatos.
 *
 * Todo mundo que escreve para a empresa já era guardado aqui automaticamente —
 * o que faltava era poder ver essa lista e puxar conversa com quem escreveu
 * antes, em vez de só responder a quem chega.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Search, UserPlus } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { formatarDataHora } from "@/lib/utils";
import {
  Aviso,
  Botao,
  Campo,
  Cartao,
  Esqueleto,
  Etiqueta,
  Modal,
  useToast,
} from "@/components/ui";
import { Avatar } from "@/components/ui";
import { useEventoTempoReal } from "@/components/app/tempo-real";

type Contato = {
  id: string;
  name: string;
  phone: string;
  phoneFormatted: string;
  isBlocked: boolean;
  lastContactAt: string | null;
  openConversationId: string | null;
};

const EVENTOS = ["conversation.created", "message.created", "realtime.reconnected"];

export function TelaContatos() {
  const router = useRouter();
  const toast = useToast();

  const [contatos, setContatos] = useState<Contato[]>([]);
  const [total, setTotal] = useState(0);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);

  const carregar = useCallback(async (termo: string) => {
    try {
      const dados = await api<{ items: Contato[]; total: number }>(
        `/api/contacts?limit=100${termo ? `&search=${encodeURIComponent(termo)}` : ""}`,
      );
      setContatos(dados.items);
      setTotal(dados.total);
    } catch {
      /* a tela mostra o vazio; o erro real aparece ao agir */
    } finally {
      setCarregando(false);
    }
  }, []);

  // Espera a digitação parar antes de consultar, para não buscar a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => void carregar(busca), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [busca, carregar]);

  useEventoTempoReal(EVENTOS, () => void carregar(busca));

  async function conversar(contato: Contato) {
    setAbrindo(contato.id);
    try {
      const { conversationId } = await api<{ conversationId: string }>(
        `/api/contacts/${contato.id}/start`,
        { method: "POST" },
      );
      router.push(`/atendimentos/${conversationId}`);
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
      setAbrindo(null);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--texto-3)]"
              aria-hidden
            />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar contatos"
              className="min-h-11 w-full rounded-lg border border-[var(--borda)] bg-[var(--superficie)] pr-3 pl-9 text-sm focus:border-[var(--primaria)]"
            />
          </div>
          <Botao
            iconeEsquerda={<UserPlus className="size-4" aria-hidden />}
            onClick={() => setNovoAberto(true)}
          >
            Novo contato
          </Botao>
        </div>

        {carregando ? (
          <div className="flex flex-col gap-2">
            <Esqueleto className="h-16 rounded-xl" />
            <Esqueleto className="h-16 rounded-xl" />
            <Esqueleto className="h-16 rounded-xl" />
          </div>
        ) : contatos.length === 0 ? (
          <Aviso tipo="info">
            {busca
              ? `Nenhum contato encontrado para "${busca}".`
              : "Ainda não há contatos. Quem escrever para a empresa entra aqui automaticamente, e você também pode cadastrar alguém."}
          </Aviso>
        ) : (
          <>
            <p className="text-xs text-[var(--texto-2)]">
              {total} contato{total === 1 ? "" : "s"}
              {busca ? " encontrado(s)" : ""}
            </p>

            <ul className="flex flex-col gap-2">
              {contatos.map((contato) => (
                <li key={contato.id}>
                  <Cartao className="flex flex-wrap items-center gap-3 p-3">
                    <Avatar nome={contato.name} tamanho={38} />

                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        {contato.name}
                        {contato.isBlocked && (
                          <Etiqueta cor="var(--color-erro)">Bloqueado</Etiqueta>
                        )}
                        {contato.openConversationId && (
                          <Etiqueta cor="var(--primaria)">Em conversa</Etiqueta>
                        )}
                      </p>
                      <p className="truncate text-xs text-[var(--texto-2)]">
                        {contato.phoneFormatted}
                        {contato.lastContactAt && (
                          <> · último contato em {formatarDataHora(contato.lastContactAt)}</>
                        )}
                      </p>
                    </div>

                    <Botao
                      variante="sutil"
                      tamanho="pequeno"
                      carregando={abrindo === contato.id}
                      disabled={contato.isBlocked}
                      iconeEsquerda={
                        <MessageSquarePlus className="size-4" aria-hidden />
                      }
                      onClick={() => void conversar(contato)}
                    >
                      {contato.openConversationId ? "Abrir" : "Conversar"}
                    </Botao>
                  </Cartao>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {novoAberto && (
        <ModalNovoContato
          aoFechar={() => setNovoAberto(false)}
          aoCriar={() => {
            setNovoAberto(false);
            void carregar(busca);
          }}
        />
      )}
    </div>
  );
}

function ModalNovoContato({
  aoFechar,
  aoCriar,
}: {
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await api("/api/contacts", {
        method: "POST",
        json: { name: nome, phone: telefone },
      });
      toast.mostrar("sucesso", "Contato cadastrado.");
      aoCriar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto titulo="Novo contato" aoFechar={aoFechar}>
      <div className="flex flex-col gap-4">
        <Campo
          rotulo="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
        />
        <Campo
          rotulo="Telefone"
          type="tel"
          inputMode="tel"
          placeholder="(11) 99999-9999"
          dica="Com DDD. O código do país é acrescentado quando faltar."
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
        />

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <div className="flex justify-end gap-2">
          <Botao variante="sutil" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            carregando={salvando}
            disabled={!nome.trim() || !telefone.trim()}
            onClick={() => void salvar()}
          >
            Cadastrar
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
