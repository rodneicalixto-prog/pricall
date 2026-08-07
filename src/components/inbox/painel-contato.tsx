"use client";

/** Painel lateral com os dados do cliente, marcadores e histórico. */
import { useCallback, useEffect, useState } from "react";
import { Ban, Pencil, Plus, X } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { formatarData, formatarDataHora, ROTULOS_STATUS } from "@/lib/utils";
import {
  Aviso,
  Botao,
  Campo,
  AreaTexto,
  Esqueleto,
  Etiqueta,
  Modal,
  useToast,
} from "@/components/ui";
import type { DetalheConversa, Marcador } from "./tipos";

type PainelContato = {
  contact: {
    id: string;
    name: string;
    phone: string;
    phoneMasked: boolean;
    email: string | null;
    companyName: string | null;
    city: string | null;
    source: string;
    notes: string | null;
    isBlocked: boolean;
    blockedReason: string | null;
    firstContactAt: string;
    lastContactAt: string;
  };
  history: {
    id: string;
    status: string;
    outcome: string | null;
    closingReason: string | null;
    createdAt: string;
    closedAt: string | null;
    assignedUserName: string | null;
  }[];
  consents: {
    id: string;
    kind: string;
    granted: boolean;
    source: string | null;
    createdAt: string;
  }[];
};

export function PainelDadosContato({
  conversaId,
  detalhe,
  aoFechar,
  aoAtualizar,
}: {
  conversaId: string;
  detalhe: DetalheConversa | null;
  aoFechar?: () => void;
  aoAtualizar?: () => void;
}) {
  const toast = useToast();
  const contatoId = detalhe?.contact?.id;

  const [dados, setDados] = useState<PainelContato | null>(null);
  const [marcadores, setMarcadores] = useState<Marcador[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [mostrarMarcadores, setMostrarMarcadores] = useState(false);

  const carregar = useCallback(async () => {
    if (!contatoId) return;
    setCarregando(true);
    try {
      const [painel, listaMarcadores] = await Promise.all([
        api<PainelContato>(`/api/contacts/${contatoId}`),
        api<{ items: Marcador[] }>("/api/tags"),
      ]);
      setDados(painel);
      setMarcadores(listaMarcadores.items);
      setErro(null);
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
  }, [contatoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function alternarMarcador(marcador: Marcador, ativo: boolean) {
    try {
      await api(`/api/conversations/${conversaId}/tags`, {
        method: ativo ? "DELETE" : "POST",
        json: { tagId: marcador.id },
      });
      aoAtualizar?.();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  async function alternarBloqueio() {
    if (!dados) return;
    const bloqueando = !dados.contact.isBlocked;
    if (
      bloqueando &&
      !confirm(
        "Bloquear este contato encerra as conversas abertas e desativa o envio. Confirmar?",
      )
    ) {
      return;
    }
    try {
      await api(`/api/contacts/${dados.contact.id}`, {
        method: "POST",
        json: { action: "block", blocked: bloqueando },
      });
      toast.mostrar(
        "sucesso",
        bloqueando ? "Contato bloqueado." : "Contato desbloqueado.",
      );
      await carregar();
      aoAtualizar?.();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  if (carregando) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Esqueleto className="h-5 w-32" />
        <Esqueleto className="h-4 w-48" />
        <Esqueleto className="h-24" />
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <div className="p-4">
        <Aviso tipo="erro">{erro ?? "Não foi possível carregar o contato."}</Aviso>
      </div>
    );
  }

  const idsMarcados = new Set(detalhe?.tags.map((t) => t.id) ?? []);

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <header className="flex items-start justify-between gap-2 border-b border-[var(--borda)] p-4">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{dados.contact.name}</h2>
          <p className="truncate text-sm text-[var(--texto-2)]">
            {dados.contact.phone}
            {dados.contact.phoneMasked && (
              <span className="ml-1 text-xs">(parcialmente oculto)</span>
            )}
          </p>
        </div>
        {aoFechar && (
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar painel do cliente"
            className="rounded-lg p-2 text-[var(--texto-2)] hover:bg-[var(--superficie-2)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </header>

      {dados.contact.isBlocked && (
        <div className="p-4 pb-0">
          <Aviso tipo="alerta">
            Contato bloqueado. O envio de mensagens está desativado.
          </Aviso>
        </div>
      )}

      <section className="flex flex-col gap-3 p-4" aria-label="Dados do cliente">
        <Linha rotulo="E-mail" valor={dados.contact.email} />
        <Linha rotulo="Empresa" valor={dados.contact.companyName} />
        <Linha rotulo="Cidade" valor={dados.contact.city} />
        <Linha rotulo="Origem do contato" valor={dados.contact.source} />
        <Linha
          rotulo="Primeiro contato"
          valor={formatarData(dados.contact.firstContactAt)}
        />
        <Linha
          rotulo="Último contato"
          valor={formatarDataHora(dados.contact.lastContactAt)}
        />
        <Linha
          rotulo="Vendedor responsável"
          valor={detalhe?.assignedUser?.name ?? "Sem responsável"}
        />

        {dados.contact.notes && (
          <div>
            <p className="text-xs font-medium text-[var(--texto-2)]">Observações</p>
            <p className="mt-0.5 text-sm whitespace-pre-wrap">
              {dados.contact.notes}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Botao
            variante="contorno"
            tamanho="pequeno"
            onClick={() => setEditando(true)}
            iconeEsquerda={<Pencil className="size-3.5" aria-hidden />}
          >
            Editar
          </Botao>
          {detalhe?.permissions.canBlockContact && (
            <Botao
              variante={dados.contact.isBlocked ? "contorno" : "perigo"}
              tamanho="pequeno"
              onClick={alternarBloqueio}
              iconeEsquerda={<Ban className="size-3.5" aria-hidden />}
            >
              {dados.contact.isBlocked ? "Desbloquear" : "Bloquear"}
            </Botao>
          )}
        </div>
      </section>

      <section className="border-t border-[var(--borda)] p-4" aria-label="Marcadores">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Marcadores</h3>
          <Botao
            variante="sutil"
            tamanho="pequeno"
            onClick={() => setMostrarMarcadores((a) => !a)}
            iconeEsquerda={<Plus className="size-3.5" aria-hidden />}
          >
            Adicionar
          </Botao>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(detalhe?.tags.length ?? 0) === 0 && (
            <p className="text-sm text-[var(--texto-2)]">
              Nenhum marcador aplicado.
            </p>
          )}
          {detalhe?.tags.map((marcador) => (
            <button
              key={marcador.id}
              type="button"
              onClick={() => void alternarMarcador(marcador, true)}
              aria-label={`Remover marcador ${marcador.name}`}
            >
              <Etiqueta cor={marcador.color}>
                {marcador.name}
                <X className="size-3" aria-hidden />
              </Etiqueta>
            </button>
          ))}
        </div>

        {mostrarMarcadores && (
          <div className="mt-3 flex flex-wrap gap-1.5 rounded-lg border border-[var(--borda)] p-3">
            {marcadores
              .filter((m) => !idsMarcados.has(m.id))
              .map((marcador) => (
                <button
                  key={marcador.id}
                  type="button"
                  onClick={() => void alternarMarcador(marcador, false)}
                >
                  <Etiqueta cor={marcador.color}>{marcador.name}</Etiqueta>
                </button>
              ))}
            {marcadores.filter((m) => !idsMarcados.has(m.id)).length === 0 && (
              <p className="text-sm text-[var(--texto-2)]">
                Todos os marcadores já foram aplicados.
              </p>
            )}
          </div>
        )}
      </section>

      <section
        className="border-t border-[var(--borda)] p-4"
        aria-label="Histórico de atendimentos"
      >
        <h3 className="mb-2 text-sm font-semibold">
          Histórico de atendimentos ({dados.history.length})
        </h3>
        <ul className="flex flex-col gap-2">
          {dados.history.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-[var(--borda)] p-2.5 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {ROTULOS_STATUS[item.status] ?? item.status}
                </span>
                <time
                  className="text-xs text-[var(--texto-3)]"
                  dateTime={item.createdAt}
                >
                  {formatarData(item.createdAt)}
                </time>
              </div>
              <p className="mt-0.5 text-xs text-[var(--texto-2)]">
                {item.assignedUserName ?? "Sem responsável"}
                {item.outcome && ` · ${item.outcome}`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {dados.consents.length > 0 && (
        <section
          className="border-t border-[var(--borda)] p-4"
          aria-label="Consentimentos registrados"
        >
          <h3 className="mb-2 text-sm font-semibold">Consentimentos</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {dados.consents.map((consentimento) => (
              <li key={consentimento.id} className="flex justify-between gap-2">
                <span>{consentimento.kind}</span>
                <span
                  className={
                    consentimento.granted
                      ? "text-[var(--color-brand-500)]"
                      : "text-[var(--color-erro)]"
                  }
                >
                  {consentimento.granted ? "Concedido" : "Negado"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ModalEdicaoContato
        aberto={editando}
        contato={dados.contact}
        aoFechar={() => setEditando(false)}
        aoSalvar={async () => {
          setEditando(false);
          await carregar();
          aoAtualizar?.();
        }}
      />
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-[var(--texto-2)]">{rotulo}</span>
      <span className="min-w-0 text-right break-words">{valor || "—"}</span>
    </div>
  );
}

function ModalEdicaoContato({
  aberto,
  contato,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  contato: PainelContato["contact"];
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
}) {
  const [dados, setDados] = useState({
    name: contato.name,
    email: contato.email ?? "",
    companyName: contato.companyName ?? "",
    city: contato.city ?? "",
    source: contato.source,
    notes: contato.notes ?? "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setDados({
      name: contato.name,
      email: contato.email ?? "",
      companyName: contato.companyName ?? "",
      city: contato.city ?? "",
      source: contato.source,
      notes: contato.notes ?? "",
    });
  }, [contato]);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await api(`/api/contacts/${contato.id}`, {
        method: "PATCH",
        json: {
          name: dados.name,
          email: dados.email || null,
          companyName: dados.companyName || null,
          city: dados.city || null,
          source: dados.source,
          notes: dados.notes || null,
        },
      });
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
      titulo="Editar dados do cliente"
      largura="estreita"
      rodape={
        <>
          <Botao variante="contorno" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} carregando={salvando}>
            Salvar
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo
          rotulo="Nome"
          obrigatorio
          value={dados.name}
          onChange={(e) => setDados({ ...dados, name: e.target.value })}
        />
        <Campo
          rotulo="E-mail"
          type="email"
          value={dados.email}
          onChange={(e) => setDados({ ...dados, email: e.target.value })}
        />
        <Campo
          rotulo="Empresa"
          value={dados.companyName}
          onChange={(e) => setDados({ ...dados, companyName: e.target.value })}
        />
        <Campo
          rotulo="Cidade"
          value={dados.city}
          onChange={(e) => setDados({ ...dados, city: e.target.value })}
        />
        <Campo
          rotulo="Origem do contato"
          value={dados.source}
          onChange={(e) => setDados({ ...dados, source: e.target.value })}
        />
        <AreaTexto
          rotulo="Observações"
          value={dados.notes}
          onChange={(e) => setDados({ ...dados, notes: e.target.value })}
        />
      </div>
    </Modal>
  );
}
