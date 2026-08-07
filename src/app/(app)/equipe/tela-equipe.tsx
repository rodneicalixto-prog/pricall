"use client";

/** Gestão de vendedores, supervisores e equipes. */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, UserPlus } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import {
  cn,
  formatarDuracao,
  ROTULOS_DISPONIBILIDADE,
  ROTULOS_PERFIL,
  tempoRelativo,
} from "@/lib/utils";
import {
  Avatar,
  Aviso,
  Botao,
  Campo,
  Cartao,
  Esqueleto,
  EstadoErro,
  Etiqueta,
  Modal,
  Selecao,
  useToast,
} from "@/components/ui";

type Membro = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: "admin" | "supervisor" | "seller";
  availabilityStatus: "online" | "away" | "offline";
  isActive: boolean;
  maxConcurrentConversations: number;
  lastActivityAt: string | null;
  activeConversations: number;
  closedToday: number;
  averageFirstResponseSeconds: number | null;
  teams: { id: string; name: string; isSupervisor: boolean }[];
};

type Equipe = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  isActive: boolean;
  memberCount: number;
};

export function TelaEquipe({ podeGerenciar }: { podeGerenciar: boolean }) {
  const toast = useToast();
  const [membros, setMembros] = useState<Membro[]>([]);
  const [equipes, setEquipes] = useState<Equipe[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modalUsuario, setModalUsuario] = useState<Membro | "novo" | null>(null);
  const [modalEquipe, setModalEquipe] = useState(false);
  const [senhaTemporaria, setSenhaTemporaria] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [usuarios, times] = await Promise.all([
        api<{ items: Membro[] }>("/api/team/users"),
        api<{ items: Equipe[] }>("/api/teams"),
      ]);
      setMembros(usuarios.items);
      setEquipes(times.items);
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

  async function redefinirSenha(membro: Membro) {
    if (!confirm(`Redefinir a senha de ${membro.name}? As sessões abertas serão encerradas.`)) {
      return;
    }
    try {
      const dados = await api<{ temporaryPassword: string }>(
        `/api/team/users/${membro.id}`,
        { method: "POST", json: { action: "reset-password" } },
      );
      setSenhaTemporaria(dados.temporaryPassword);
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  async function alternarAtivo(membro: Membro) {
    const desativando = membro.isActive;
    if (
      desativando &&
      !confirm(
        `Desativar ${membro.name}? O histórico é preservado e as conversas dele voltam para a fila.`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/team/users/${membro.id}`, {
        method: "PATCH",
        json: { isActive: !membro.isActive },
      });
      toast.mostrar("sucesso", desativando ? "Usuário desativado." : "Usuário reativado.");
      await carregar();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  if (carregando) {
    return (
      <div className="flex flex-col gap-3 overflow-y-auto p-4 lg:p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Esqueleto key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  if (erro) {
    return <EstadoErro mensagem={erro} aoTentarNovamente={() => void carregar()} />;
  }

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-4 lg:p-6">
      {senhaTemporaria && (
        <Aviso tipo="sucesso">
          Senha temporária gerada: <code className="font-mono font-bold">{senhaTemporaria}</code>.
          Anote agora — ela não será exibida novamente. Peça ao usuário para
          trocá-la no primeiro acesso.
          <button
            type="button"
            onClick={() => setSenhaTemporaria(null)}
            className="ml-2 text-xs underline"
          >
            Ocultar
          </button>
        </Aviso>
      )}

      <section aria-label="Equipes">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Equipes e setores</h2>
          {podeGerenciar && (
            <Botao
              variante="contorno"
              tamanho="pequeno"
              onClick={() => setModalEquipe(true)}
              iconeEsquerda={<Plus className="size-3.5" aria-hidden />}
            >
              Nova equipe
            </Botao>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {equipes.length === 0 && (
            <p className="text-sm text-[var(--texto-2)]">
              Nenhuma equipe cadastrada.
            </p>
          )}
          {equipes.map((equipe) => (
            <Etiqueta key={equipe.id} cor={equipe.color}>
              {equipe.name} · {equipe.memberCount} pessoa(s)
            </Etiqueta>
          ))}
        </div>
      </section>

      <section aria-label="Usuários">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Usuários ({membros.filter((m) => m.isActive).length} ativos)
          </h2>
          {podeGerenciar && (
            <Botao
              tamanho="pequeno"
              onClick={() => setModalUsuario("novo")}
              iconeEsquerda={<UserPlus className="size-3.5" aria-hidden />}
            >
              Cadastrar usuário
            </Botao>
          )}
        </div>

        <ul className="flex flex-col gap-2">
          {membros.map((membro) => (
            <li key={membro.id}>
              <Cartao className={cn(!membro.isActive && "opacity-60")}>
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar
                    nome={membro.name}
                    url={membro.avatarUrl}
                    tamanho={44}
                    disponibilidade={membro.availabilityStatus}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{membro.name}</p>
                      <Etiqueta cor={membro.role === "admin" ? "#166534" : membro.role === "supervisor" ? "#2563EB" : "#64748B"}>
                        {ROTULOS_PERFIL[membro.role]}
                      </Etiqueta>
                      {!membro.isActive && <Etiqueta cor="#DC2626">Desativado</Etiqueta>}
                    </div>
                    <p className="truncate text-sm text-[var(--texto-2)]">
                      {membro.email}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {membro.teams.map((equipe) => (
                        <Etiqueta key={equipe.id} cor="#94A3B8">
                          {equipe.name}
                          {equipe.isSupervisor && " (supervisor)"}
                        </Etiqueta>
                      ))}
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs sm:grid-cols-4">
                    <Metrica rotulo="Situação" valor={ROTULOS_DISPONIBILIDADE[membro.availabilityStatus]} />
                    <Metrica rotulo="Ativos" valor={String(membro.activeConversations)} />
                    <Metrica rotulo="Finalizados hoje" valor={String(membro.closedToday)} />
                    <Metrica
                      rotulo="1ª resposta"
                      valor={formatarDuracao(membro.averageFirstResponseSeconds)}
                    />
                    <Metrica
                      rotulo="Última atividade"
                      valor={membro.lastActivityAt ? tempoRelativo(membro.lastActivityAt) : "—"}
                    />
                    <Metrica
                      rotulo="Limite simultâneo"
                      valor={String(membro.maxConcurrentConversations)}
                    />
                  </dl>

                  {podeGerenciar && (
                    <div className="flex flex-wrap gap-1.5">
                      <Botao
                        variante="contorno"
                        tamanho="pequeno"
                        onClick={() => setModalUsuario(membro)}
                        iconeEsquerda={<Pencil className="size-3.5" aria-hidden />}
                      >
                        Editar
                      </Botao>
                      <Botao
                        variante="contorno"
                        tamanho="pequeno"
                        onClick={() => void redefinirSenha(membro)}
                        iconeEsquerda={<KeyRound className="size-3.5" aria-hidden />}
                      >
                        Redefinir senha
                      </Botao>
                      <Botao
                        variante={membro.isActive ? "perigo" : "contorno"}
                        tamanho="pequeno"
                        onClick={() => void alternarAtivo(membro)}
                      >
                        {membro.isActive ? "Desativar" : "Reativar"}
                      </Botao>
                    </div>
                  )}
                </div>
              </Cartao>
            </li>
          ))}
        </ul>
      </section>

      {modalUsuario && (
        <ModalUsuario
          membro={modalUsuario === "novo" ? null : modalUsuario}
          equipes={equipes}
          aoFechar={() => setModalUsuario(null)}
          aoSalvar={async (senha) => {
            setModalUsuario(null);
            if (senha) setSenhaTemporaria(senha);
            await carregar();
          }}
        />
      )}

      <ModalNovaEquipe
        aberto={modalEquipe}
        aoFechar={() => setModalEquipe(false)}
        aoSalvar={async () => {
          setModalEquipe(false);
          await carregar();
        }}
      />
    </div>
  );
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-[var(--texto-3)]">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  );
}

function ModalUsuario({
  membro,
  equipes,
  aoFechar,
  aoSalvar,
}: {
  membro: Membro | null;
  equipes: Equipe[];
  aoFechar: () => void;
  aoSalvar: (senhaTemporaria?: string) => void | Promise<void>;
}) {
  const [dados, setDados] = useState({
    name: membro?.name ?? "",
    email: membro?.email ?? "",
    phone: membro?.phone ?? "",
    role: membro?.role ?? ("seller" as const),
    maxConcurrentConversations: membro?.maxConcurrentConversations ?? 20,
    teamIds: membro?.teams.map((t) => t.id) ?? [],
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      if (membro) {
        await api(`/api/team/users/${membro.id}`, {
          method: "PATCH",
          json: {
            name: dados.name,
            phone: dados.phone || null,
            role: dados.role,
            maxConcurrentConversations: dados.maxConcurrentConversations,
            teamIds: dados.teamIds,
          },
        });
        await aoSalvar();
      } else {
        const resultado = await api<{ temporaryPassword: string | null }>(
          "/api/team/users",
          {
            method: "POST",
            json: {
              name: dados.name,
              email: dados.email,
              phone: dados.phone || undefined,
              role: dados.role,
              maxConcurrentConversations: dados.maxConcurrentConversations,
              teamIds: dados.teamIds,
            },
          },
        );
        await aoSalvar(resultado.temporaryPassword ?? undefined);
      }
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
      titulo={membro ? "Editar usuário" : "Cadastrar usuário"}
      descricao={
        membro
          ? "Usuários com histórico nunca são excluídos — apenas desativados."
          : "Uma senha temporária será gerada e exibida uma única vez."
      }
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
          obrigatorio
          disabled={Boolean(membro)}
          dica={membro ? "O e-mail não pode ser alterado." : undefined}
          value={dados.email}
          onChange={(e) => setDados({ ...dados, email: e.target.value })}
        />
        <Campo
          rotulo="Telefone"
          type="tel"
          value={dados.phone}
          onChange={(e) => setDados({ ...dados, phone: e.target.value })}
        />
        <Selecao
          rotulo="Perfil"
          obrigatorio
          value={dados.role}
          onChange={(e) =>
            setDados({ ...dados, role: e.target.value as Membro["role"] })
          }
        >
          <option value="seller">Vendedor</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Administrador</option>
        </Selecao>
        <Campo
          rotulo="Limite de atendimentos simultâneos"
          type="number"
          min={0}
          max={200}
          dica="Usado pelas regras de distribuição automática."
          value={dados.maxConcurrentConversations}
          onChange={(e) =>
            setDados({
              ...dados,
              maxConcurrentConversations: Number(e.target.value),
            })
          }
        />
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Equipes</legend>
          <div className="flex flex-col gap-1.5">
            {equipes.length === 0 && (
              <p className="text-sm text-[var(--texto-2)]">
                Nenhuma equipe cadastrada ainda.
              </p>
            )}
            {equipes.map((equipe) => (
              <label key={equipe.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dados.teamIds.includes(equipe.id)}
                  onChange={(e) =>
                    setDados({
                      ...dados,
                      teamIds: e.target.checked
                        ? [...dados.teamIds, equipe.id]
                        : dados.teamIds.filter((id) => id !== equipe.id),
                    })
                  }
                  className="size-4 rounded accent-[var(--primaria)]"
                />
                {equipe.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

function ModalNovaEquipe({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState("#16A34A");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await api("/api/teams", {
        method: "POST",
        json: { name: nome, description: descricao || undefined, color: cor },
      });
      setNome("");
      setDescricao("");
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
      titulo="Nova equipe"
      descricao="Equipes representam setores de atendimento e podem ter número próprio."
      largura="estreita"
      rodape={
        <>
          <Botao variante="contorno" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} carregando={salvando}>
            Criar equipe
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo
          rotulo="Nome da equipe"
          obrigatorio
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Vendas, Suporte, Pós-venda"
        />
        <Campo
          rotulo="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
        <Campo
          rotulo="Cor"
          type="color"
          value={cor}
          onChange={(e) => setCor(e.target.value)}
          className="h-11 w-24 p-1"
        />
      </div>
    </Modal>
  );
}
