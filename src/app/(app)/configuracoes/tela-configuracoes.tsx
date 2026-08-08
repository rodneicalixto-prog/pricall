"use client";

/**
 * Configurações da empresa, integrações, catálogos, preferências pessoais,
 * segurança e painel de integridade.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bell,
  Building2,
  Clock,
  Palette,
  Plug,
  Shield,
  Sparkles,
  Tags,
  Zap,
} from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import {
  cn,
  formatarDataHora,
  ROTULOS_DISPONIBILIDADE,
} from "@/lib/utils";
import {
  AreaTexto,
  Aviso,
  Botao,
  Campo,
  Cartao,
  Esqueleto,
  Etiqueta,
  Modal,
  Selecao,
  useToast,
} from "@/components/ui";
import { useSessao } from "@/components/app/sessao";
import { DAY_KEYS, DAY_LABELS } from "@/lib/business-hours";

type Configuracoes = {
  id: string;
  name: string;
  segment: string | null;
  timezone: string;
  businessHours: Record<string, { start: string; end: string }[]>;
  branding: { primaryColor?: string; logoUrl?: string; inboxName?: string };
  settings: {
    aiEnabled?: boolean;
    aiSummaryEnabled?: boolean;
    demoMode?: boolean;
    slaFirstResponseMinutes?: number;
    slaStaleConversationMinutes?: number;
    assignOutsideBusinessHours?: boolean;
    dataRetentionDays?: number;
    maskPhoneForSellers?: boolean;
  };
};

type Conexao = {
  id: string;
  label: string;
  provider: string;
  scope: string;
  teamName: string | null;
  ownerName: string | null;
  extension: string | null;
  displayPhoneNumber: string;
  status: string;
  webhookVerified: boolean;
  isDemo: boolean;
  isDefault: boolean;
  lastWebhookAt: string | null;
  lastErrorMessage: string | null;
  secretReference: string | null;
  secretConfigured: boolean;
};

type Saude = {
  events: { received: number; processed: number; failed: number; pending: number };
  messages: { sent: number; delivered: number; failed: number; received: number };
  openConversations: number;
  recentErrors: {
    id: string;
    provider: string;
    eventType: string;
    errorMessage: string | null;
    attemptCount: number;
    receivedAt: string;
  }[];
};

type Aba =
  | "empresa"
  | "horario"
  | "integracao"
  | "distribuicao"
  | "respostas"
  | "marcadores"
  | "notificacoes"
  | "ia"
  | "aparencia"
  | "seguranca"
  | "saude";

const ABAS: { chave: Aba; rotulo: string; Icone: typeof Building2; adminApenas?: boolean }[] = [
  { chave: "empresa", rotulo: "Dados da empresa", Icone: Building2, adminApenas: true },
  { chave: "horario", rotulo: "Horário de funcionamento", Icone: Clock, adminApenas: true },
  { chave: "integracao", rotulo: "Integração do WhatsApp", Icone: Plug },
  { chave: "distribuicao", rotulo: "Distribuição automática", Icone: Zap, adminApenas: true },
  { chave: "respostas", rotulo: "Respostas rápidas", Icone: Zap },
  { chave: "marcadores", rotulo: "Marcadores", Icone: Tags },
  { chave: "notificacoes", rotulo: "Notificações", Icone: Bell },
  { chave: "ia", rotulo: "Inteligência artificial", Icone: Sparkles, adminApenas: true },
  { chave: "aparencia", rotulo: "Aparência", Icone: Palette },
  { chave: "seguranca", rotulo: "Segurança e privacidade", Icone: Shield, adminApenas: true },
  { chave: "saude", rotulo: "Integridade e logs", Icone: Activity },
];

export function TelaConfiguracoes() {
  const { pode, preferencias, definirPreferencias } = useSessao();
  const toast = useToast();

  const [aba, setAba] = useState<Aba>("empresa");
  const [config, setConfig] = useState<Configuracoes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const podeGerenciar = pode("organization.manage");
  const abas = ABAS.filter((a) => !a.adminApenas || podeGerenciar);

  const carregar = useCallback(async () => {
    try {
      setConfig(await api<Configuracoes>("/api/settings"));
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void carregar();
    setAba(podeGerenciar ? "empresa" : "integracao");
  }, [carregar, podeGerenciar]);

  async function salvar(parcial: Partial<Configuracoes>) {
    setSalvando(true);
    try {
      await api("/api/settings", { method: "PATCH", json: parcial });
      toast.mostrar("sucesso", "Configurações salvas.");
      await carregar();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setSalvando(false);
    }
  }

  if (carregando || !config) {
    return (
      <div className="flex flex-col gap-3 p-4 lg:p-6">
        <Esqueleto className="h-10 w-64" />
        <Esqueleto className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <nav
        className="shrink-0 overflow-x-auto border-b border-[var(--borda)] p-2 lg:w-64 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-3"
        aria-label="Seções de configuração"
      >
        <ul className="flex gap-1 lg:flex-col">
          {abas.map(({ chave, rotulo, Icone }) => (
            <li key={chave} className="shrink-0">
              <button
                type="button"
                onClick={() => setAba(chave)}
                aria-current={aba === chave ? "true" : undefined}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors",
                  aba === chave
                    ? "bg-[var(--primaria)]/12 text-[var(--primaria)]"
                    : "text-[var(--texto-2)] hover:bg-[var(--superficie-2)]",
                )}
              >
                <Icone className="size-4 shrink-0" aria-hidden />
                {rotulo}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {aba === "empresa" && (
          <SecaoEmpresa config={config} salvando={salvando} aoSalvar={salvar} />
        )}
        {aba === "horario" && (
          <SecaoHorario config={config} salvando={salvando} aoSalvar={salvar} />
        )}
        {aba === "integracao" && <SecaoIntegracao podeGerenciar={pode("integrations.manage")} />}
        {aba === "distribuicao" && (
          <SecaoDistribuicao config={config} salvando={salvando} aoSalvar={salvar} />
        )}
        {aba === "respostas" && <SecaoRespostas podeGerenciar={pode("quick_replies.manage")} />}
        {aba === "marcadores" && <SecaoMarcadores podeGerenciar={pode("tags.manage")} />}
        {aba === "notificacoes" && <SecaoNotificacoes />}
        {aba === "ia" && (
          <SecaoIa config={config} salvando={salvando} aoSalvar={salvar} />
        )}
        {aba === "aparencia" && (
          <SecaoAparencia
            preferencias={preferencias}
            definirPreferencias={definirPreferencias}
            config={config}
            podeGerenciar={podeGerenciar}
            aoSalvar={salvar}
          />
        )}
        {aba === "seguranca" && (
          <SecaoSeguranca config={config} salvando={salvando} aoSalvar={salvar} />
        )}
        {aba === "saude" && <SecaoSaude podeReprocessar={pode("health.retry_events")} />}
      </div>
    </div>
  );
}

/* ------------------------------ Seções ------------------------------ */

function SecaoEmpresa({
  config,
  salvando,
  aoSalvar,
}: {
  config: Configuracoes;
  salvando: boolean;
  aoSalvar: (p: Partial<Configuracoes>) => void;
}) {
  const [nome, setNome] = useState(config.name);
  const [segmento, setSegmento] = useState(config.segment ?? "");
  const [fuso, setFuso] = useState(config.timezone);
  const [demonstracao, setDemonstracao] = useState(
    config.settings.demoMode ?? false,
  );

  return (
    <Cartao className="max-w-2xl">
      <h2 className="mb-4 text-base font-semibold">Dados da empresa</h2>
      <div className="flex flex-col gap-4">
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Campo
          rotulo="Segmento"
          value={segmento}
          onChange={(e) => setSegmento(e.target.value)}
        />
        <Selecao
          rotulo="Fuso horário"
          value={fuso}
          onChange={(e) => setFuso(e.target.value)}
        >
          <option value="America/Sao_Paulo">Brasília (America/Sao_Paulo)</option>
          <option value="America/Manaus">Manaus (America/Manaus)</option>
          <option value="America/Belem">Belém (America/Belem)</option>
          <option value="America/Cuiaba">Cuiabá (America/Cuiaba)</option>
          <option value="America/Rio_Branco">Rio Branco (America/Rio_Branco)</option>
          <option value="America/Fortaleza">Fortaleza (America/Fortaleza)</option>
        </Selecao>

        <div className="rounded-lg border border-[var(--borda)] p-3">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={demonstracao}
              onChange={(e) => setDemonstracao(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 rounded accent-[var(--primaria)]"
            />
            <span>
              Modo demonstração
              <span className="mt-0.5 block text-xs text-[var(--texto-2)]">
                Exibe o selo laranja na lateral e libera o simulador de
                conversas. Desligue quando a central passar a atender clientes
                de verdade — o selo dá a entender que nada ali é real.
              </span>
            </span>
          </label>
        </div>

        <Botao
          className="self-start"
          carregando={salvando}
          onClick={() =>
            aoSalvar({
              name: nome,
              segment: segmento,
              timezone: fuso,
              settings: { ...config.settings, demoMode: demonstracao },
            })
          }
        >
          Salvar alterações
        </Botao>
      </div>
    </Cartao>
  );
}

function SecaoHorario({
  config,
  salvando,
  aoSalvar,
}: {
  config: Configuracoes;
  salvando: boolean;
  aoSalvar: (p: Partial<Configuracoes>) => void;
}) {
  const [horarios, setHorarios] = useState(config.businessHours ?? {});

  function alterarDia(dia: string, campo: "start" | "end", valor: string) {
    setHorarios((atual) => {
      const faixas = atual[dia]?.length ? [...atual[dia]] : [{ start: "08:00", end: "18:00" }];
      faixas[0] = { ...faixas[0], [campo]: valor };
      return { ...atual, [dia]: faixas };
    });
  }

  function alternarDia(dia: string, ativo: boolean) {
    setHorarios((atual) => ({
      ...atual,
      [dia]: ativo ? [{ start: "08:00", end: "18:00" }] : [],
    }));
  }

  return (
    <Cartao className="max-w-2xl">
      <h2 className="mb-1 text-base font-semibold">Horário de funcionamento</h2>
      <p className="mb-4 text-sm text-[var(--texto-2)]">
        Conversas recebidas fora do expediente ficam marcadas e podem não ser
        distribuídas automaticamente.
      </p>

      <div className="flex flex-col gap-3">
        {DAY_KEYS.map((dia) => {
          const faixas = horarios[dia] ?? [];
          const ativo = faixas.length > 0;
          return (
            <div key={dia} className="flex flex-wrap items-center gap-3">
              <label className="flex w-40 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={(e) => alternarDia(dia, e.target.checked)}
                  className="size-4 rounded accent-[var(--primaria)]"
                />
                {DAY_LABELS[dia]}
              </label>
              {ativo && (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    aria-label={`Início — ${DAY_LABELS[dia]}`}
                    value={faixas[0]?.start ?? "08:00"}
                    onChange={(e) => alterarDia(dia, "start", e.target.value)}
                    className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
                  />
                  <span className="text-sm text-[var(--texto-2)]">às</span>
                  <input
                    type="time"
                    aria-label={`Término — ${DAY_LABELS[dia]}`}
                    value={faixas[0]?.end ?? "18:00"}
                    onChange={(e) => alterarDia(dia, "end", e.target.value)}
                    className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
                  />
                </div>
              )}
            </div>
          );
        })}

        <Botao
          className="mt-2 self-start"
          carregando={salvando}
          onClick={() => aoSalvar({ businessHours: horarios })}
        >
          Salvar horários
        </Botao>
      </div>
    </Cartao>
  );
}

function SecaoIntegracao({ podeGerenciar }: { podeGerenciar: boolean }) {
  const toast = useToast();
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [modal, setModal] = useState(false);
  const [testando, setTestando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const dados = await api<{ items: Conexao[] }>("/api/connections");
      setConexoes(dados.items);
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function testar(id: string) {
    setTestando(id);
    try {
      const resultado = await api<{ ok: boolean; detail: string }>(
        `/api/connections/${id}/test`,
        { method: "POST" },
      );
      toast.mostrar(resultado.ok ? "sucesso" : "erro", resultado.detail);
      await carregar();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setTestando(null);
    }
  }

  if (carregando) return <Esqueleto className="h-64 rounded-xl" />;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Aviso tipo="info">
        A integração usa a plataforma oficial do WhatsApp Business (Cloud API) ou
        a Evolution API. Os tokens ficam apenas em variáveis de ambiente: o banco
        guarda somente a <strong>referência</strong> ao segredo.
      </Aviso>

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Números conectados</h2>
        {podeGerenciar && <Botao onClick={() => setModal(true)}>Conectar número</Botao>}
      </div>

      <ul className="flex flex-col gap-3">
        {conexoes.map((conexao) => (
          <li key={conexao.id}>
            <Cartao>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{conexao.label}</p>
                    {conexao.isDefault && <Etiqueta cor="#16A34A">Padrão</Etiqueta>}
                    {conexao.isDemo && <Etiqueta cor="#F59E0B">Demonstração</Etiqueta>}
                    <Etiqueta
                      cor={
                        conexao.status === "connected"
                          ? "#16A34A"
                          : conexao.status === "error"
                            ? "#DC2626"
                            : "#64748B"
                      }
                    >
                      {conexao.status === "connected"
                        ? "Conectado"
                        : conexao.status === "error"
                          ? "Com erro"
                          : conexao.status === "disabled"
                            ? "Desativado"
                            : "Pendente"}
                    </Etiqueta>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--texto-2)]">
                    {conexao.displayPhoneNumber}
                    {conexao.extension && ` · ramal ${conexao.extension}`}
                    {" · "}
                    {conexao.provider === "cloud_api"
                      ? "Cloud API (Meta)"
                      : conexao.provider === "evolution"
                        ? "Evolution API"
                        : "Demonstração"}
                  </p>
                  <p className="text-xs text-[var(--texto-3)]">
                    Alcance:{" "}
                    {conexao.scope === "organization"
                      ? "empresa"
                      : conexao.scope === "team"
                        ? `setor ${conexao.teamName ?? ""}`
                        : `vendedor ${conexao.ownerName ?? ""}`}
                    {conexao.lastWebhookAt &&
                      ` · último evento em ${formatarDataHora(conexao.lastWebhookAt)}`}
                  </p>
                  {conexao.secretReference && (
                    <p className="mt-1 text-xs">
                      Segredo:{" "}
                      <code className="rounded bg-[var(--superficie-2)] px-1">
                        {conexao.secretReference}
                      </code>{" "}
                      {conexao.secretConfigured ? (
                        <span className="text-[var(--color-brand-500)]">
                          (configurado)
                        </span>
                      ) : (
                        <span className="text-[var(--color-erro)]">
                          (variável ausente no ambiente)
                        </span>
                      )}
                    </p>
                  )}
                  {conexao.lastErrorMessage && (
                    <p className="mt-1 text-xs text-[var(--color-erro)]">
                      {conexao.lastErrorMessage}
                    </p>
                  )}
                </div>

                {podeGerenciar && (
                  <Botao
                    variante="contorno"
                    tamanho="pequeno"
                    carregando={testando === conexao.id}
                    onClick={() => void testar(conexao.id)}
                  >
                    Testar conexão
                  </Botao>
                )}
              </div>
            </Cartao>
          </li>
        ))}
        {conexoes.length === 0 && (
          <p className="text-sm text-[var(--texto-2)]">
            Nenhum número conectado. Use o modo demonstração para testar o
            sistema antes de configurar a Meta.
          </p>
        )}
      </ul>

      {podeGerenciar && (
        <ModalNovaConexao
          aberto={modal}
          aoFechar={() => setModal(false)}
          aoSalvar={async () => {
            setModal(false);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function ModalNovaConexao({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
}) {
  const [dados, setDados] = useState({
    label: "",
    provider: "mock" as "mock" | "cloud_api" | "evolution",
    scope: "organization" as "organization" | "team" | "user",
    displayPhoneNumber: "",
    teamId: "",
    ownerUserId: "",
    extension: "",
    phoneNumberId: "",
    whatsappBusinessAccountId: "",
    apiBaseUrl: "",
    instanceName: "",
    tokenReference: "",
  });
  const [equipes, setEquipes] = useState<{ id: string; name: string }[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: string; name: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    void api<{ items: { id: string; name: string }[] }>("/api/teams")
      .then((d) => setEquipes(d.items))
      .catch(() => {});
    void api<{ items: { id: string; name: string }[] }>("/api/team/users")
      .then((d) => setUsuarios(d.items))
      .catch(() => {});
  }, [aberto]);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await api("/api/connections", {
        method: "POST",
        json: {
          label: dados.label,
          provider: dados.provider,
          scope: dados.scope,
          displayPhoneNumber: dados.displayPhoneNumber || "+55 (11) 0000-0000",
          teamId: dados.scope === "team" ? dados.teamId : null,
          ownerUserId: dados.scope === "user" ? dados.ownerUserId : null,
          extension: dados.extension || null,
          phoneNumberId: dados.phoneNumberId || null,
          whatsappBusinessAccountId: dados.whatsappBusinessAccountId || null,
          apiBaseUrl: dados.apiBaseUrl || null,
          instanceName: dados.instanceName || null,
          tokenReference: dados.tokenReference || null,
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
      titulo="Conectar número"
      descricao="Número principal da empresa, número de um setor ou número individual de um vendedor."
      rodape={
        <>
          <Botao variante="contorno" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} carregando={salvando}>
            Conectar
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Campo
          rotulo="Identificação"
          obrigatorio
          value={dados.label}
          onChange={(e) => setDados({ ...dados, label: e.target.value })}
          placeholder="Ex.: Número principal, Vendas — ramal 101"
        />

        <Selecao
          rotulo="Provedor"
          value={dados.provider}
          onChange={(e) =>
            setDados({ ...dados, provider: e.target.value as typeof dados.provider })
          }
        >
          <option value="mock">Modo demonstração (sem credenciais)</option>
          <option value="cloud_api">WhatsApp Business Cloud API (Meta)</option>
          <option value="evolution">Evolution API</option>
        </Selecao>

        <Selecao
          rotulo="Alcance do número"
          value={dados.scope}
          onChange={(e) =>
            setDados({ ...dados, scope: e.target.value as typeof dados.scope })
          }
        >
          <option value="organization">Empresa inteira</option>
          <option value="team">Setor específico</option>
          <option value="user">Vendedor específico</option>
        </Selecao>

        {dados.scope === "team" && (
          <Selecao
            rotulo="Setor"
            obrigatorio
            value={dados.teamId}
            onChange={(e) => setDados({ ...dados, teamId: e.target.value })}
          >
            <option value="">Selecione…</option>
            {equipes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Selecao>
        )}

        {dados.scope === "user" && (
          <Selecao
            rotulo="Vendedor"
            obrigatorio
            value={dados.ownerUserId}
            onChange={(e) => setDados({ ...dados, ownerUserId: e.target.value })}
          >
            <option value="">Selecione…</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Selecao>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            rotulo="Número exibido"
            value={dados.displayPhoneNumber}
            onChange={(e) => setDados({ ...dados, displayPhoneNumber: e.target.value })}
            placeholder="+55 (11) 3000-0000"
          />
          <Campo
            rotulo="Ramal (opcional)"
            value={dados.extension}
            onChange={(e) => setDados({ ...dados, extension: e.target.value })}
            placeholder="101"
          />
        </div>

        {dados.provider === "cloud_api" && (
          <>
            <Campo
              rotulo="Identificador do número (phone_number_id)"
              obrigatorio
              value={dados.phoneNumberId}
              onChange={(e) => setDados({ ...dados, phoneNumberId: e.target.value })}
            />
            <Campo
              rotulo="Identificador da conta comercial (WABA ID)"
              value={dados.whatsappBusinessAccountId}
              onChange={(e) =>
                setDados({ ...dados, whatsappBusinessAccountId: e.target.value })
              }
            />
          </>
        )}

        {dados.provider === "evolution" && (
          <>
            <Campo
              rotulo="URL da Evolution API"
              obrigatorio
              type="url"
              value={dados.apiBaseUrl}
              onChange={(e) => setDados({ ...dados, apiBaseUrl: e.target.value })}
              placeholder="https://evolution.suaempresa.com.br"
            />
            <Campo
              rotulo="Nome da instância"
              obrigatorio
              value={dados.instanceName}
              onChange={(e) => setDados({ ...dados, instanceName: e.target.value })}
            />
          </>
        )}

        {dados.provider !== "mock" && (
          <Campo
            rotulo="Referência ao segredo"
            value={dados.tokenReference}
            onChange={(e) => setDados({ ...dados, tokenReference: e.target.value })}
            placeholder="env:WHATSAPP_ACCESS_TOKEN"
            dica="Informe o nome da variável de ambiente que guarda o token. O token em si nunca é salvo no banco."
          />
        )}
      </div>
    </Modal>
  );
}

type RegraPrincipal = {
  strategy: string;
  teamId: string | null;
  requireOnline: boolean;
};

const ESTRATEGIAS: { valor: string; rotulo: string; descricao: string }[] = [
  {
    valor: "manual",
    rotulo: "Manual",
    descricao:
      "Ninguém recebe automaticamente. Toda conversa fica em “Não atribuídos” até alguém assumir.",
  },
  {
    valor: "least_active",
    rotulo: "Menor carga",
    descricao:
      "Entrega para quem tem menos atendimentos abertos. Equilibra o volume entre a equipe.",
  },
  {
    valor: "round_robin",
    rotulo: "Rodízio",
    descricao:
      "Distribui em ordem, um para cada vendedor. Simples e previsível.",
  },
  {
    valor: "first_available",
    rotulo: "Primeiro a assumir",
    descricao:
      "Avisa todos ao mesmo tempo; o atendimento é de quem pegar primeiro.",
  },
];

/**
 * A estratégia era escolhida uma única vez no onboarding e não havia como
 * revisá-la. Quem passasse batido ficava com distribuição manual sem entender
 * por que os vendedores cadastrados nunca recebiam conversa.
 */
function SecaoEstrategia() {
  const [regra, setRegra] = useState<RegraPrincipal | null>(null);
  const [escolha, setEscolha] = useState("manual");
  const [exigirOnline, setExigirOnline] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    void api<RegraPrincipal>("/api/assignment-rules")
      .then((r) => {
        setRegra(r);
        setEscolha(r.strategy);
        setExigirOnline(r.requireOnline);
      })
      .catch(() => setErro("Não foi possível carregar a regra atual."));
  }, []);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const atualizada = await api<RegraPrincipal>("/api/assignment-rules", {
        method: "PATCH",
        json: { strategy: escolha, requireOnline: exigirOnline },
      });
      setRegra(atualizada);
      toast.mostrar("sucesso", "Distribuição atualizada.");
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao>
      <h2 className="mb-1 text-base font-semibold">
        Como as conversas são distribuídas
      </h2>
      <p className="mb-4 text-sm text-[var(--texto-2)]">
        Vale para conversas novas, sem responsável. Quem já está atendendo não é
        afetado.
      </p>

      {!regra ? (
        <p className="text-sm text-[var(--texto-2)]">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {ESTRATEGIAS.map((op) => (
            <label
              key={op.valor}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--borda)] p-3 text-sm"
            >
              <input
                type="radio"
                name="estrategia"
                value={op.valor}
                checked={escolha === op.valor}
                onChange={() => setEscolha(op.valor)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--primaria)]"
              />
              <span>
                {op.rotulo}
                <span className="mt-0.5 block text-xs text-[var(--texto-2)]">
                  {op.descricao}
                </span>
              </span>
            </label>
          ))}

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={exigirOnline}
              onChange={(e) => setExigirOnline(e.target.checked)}
              disabled={escolha === "manual"}
              className="mt-0.5 size-4 shrink-0 rounded accent-[var(--primaria)]"
            />
            <span>
              Só distribuir para quem está online
              <span className="block text-xs text-[var(--texto-2)]">
                Desligado, a conversa também vai para quem está ausente — útil
                em equipe pequena, onde deixar na fila é pior.
              </span>
            </span>
          </label>

          {erro && <p className="text-sm text-[var(--color-erro)]">{erro}</p>}

          <Botao className="self-start" carregando={salvando} onClick={salvar}>
            Salvar distribuição
          </Botao>
        </div>
      )}
    </Cartao>
  );
}

function SecaoDistribuicao({
  config,
  salvando,
  aoSalvar,
}: {
  config: Configuracoes;
  salvando: boolean;
  aoSalvar: (p: Partial<Configuracoes>) => void;
}) {
  const [distribuirForaHorario, setDistribuirForaHorario] = useState(
    config.settings.assignOutsideBusinessHours ?? false,
  );
  const [slaResposta, setSlaResposta] = useState(
    config.settings.slaFirstResponseMinutes ?? 10,
  );
  const [slaParada, setSlaParada] = useState(
    config.settings.slaStaleConversationMinutes ?? 30,
  );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <SecaoEstrategia />

      <Cartao>
        <h2 className="mb-1 text-base font-semibold">Limites e horário</h2>
        <p className="mb-4 text-sm text-[var(--texto-2)]">
          Prazos de atendimento e o que fazer com o que chega fora do
          expediente.
        </p>

        <div className="flex flex-col gap-4">
          <Campo
            rotulo="SLA de primeira resposta (minutos)"
            type="number"
            min={1}
            max={1440}
            value={slaResposta}
            onChange={(e) => setSlaResposta(Number(e.target.value))}
          />
          <Campo
            rotulo="Alerta de conversa parada (minutos)"
            type="number"
            min={1}
            max={1440}
            dica="Tempo de espera do cliente que dispara o alerta para o responsável."
            value={slaParada}
            onChange={(e) => setSlaParada(Number(e.target.value))}
          />
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={distribuirForaHorario}
              onChange={(e) => setDistribuirForaHorario(e.target.checked)}
              className="mt-0.5 size-4 rounded accent-[var(--primaria)]"
            />
            <span>
              Distribuir automaticamente fora do horário de funcionamento
              <span className="block text-xs text-[var(--texto-2)]">
                Desligado, as conversas recebidas fora do expediente ficam na
                fila para o próximo período.
              </span>
            </span>
          </label>

          <Botao
            className="self-start"
            carregando={salvando}
            onClick={() =>
              aoSalvar({
                settings: {
                  ...config.settings,
                  assignOutsideBusinessHours: distribuirForaHorario,
                  slaFirstResponseMinutes: slaResposta,
                  slaStaleConversationMinutes: slaParada,
                },
              })
            }
          >
            Salvar
          </Botao>
        </div>
      </Cartao>
    </div>
  );
}

function SecaoRespostas({ podeGerenciar }: { podeGerenciar: boolean }) {
  const toast = useToast();
  const [itens, setItens] = useState<
    { id: string; title: string; shortcut: string; content: string; category: string | null; isActive: boolean }[]
  >([]);
  const [modal, setModal] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const dados = await api<{ items: typeof itens }>(
        "/api/quick-replies?includeInactive=true",
      );
      setItens(dados.items);
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) return <Esqueleto className="h-64 rounded-xl" />;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Respostas rápidas</h2>
        {podeGerenciar && <Botao onClick={() => setModal(true)}>Nova resposta</Botao>}
      </div>

      <Aviso tipo="info">
        Variáveis disponíveis: <code>{"{{nome_cliente}}"}</code>,{" "}
        <code>{"{{primeiro_nome_cliente}}"}</code>,{" "}
        <code>{"{{nome_vendedor}}"}</code>, <code>{"{{nome_empresa}}"}</code>,{" "}
        <code>{"{{horario_atendimento}}"}</code>,{" "}
        <code>{"{{telefone_cliente}}"}</code>, <code>{"{{data_hoje}}"}</code>.
      </Aviso>

      <ul className="flex flex-col gap-2">
        {itens.map((item) => (
          <li key={item.id}>
            <Cartao className={cn(!item.isActive && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{item.title}</p>
                <code className="rounded bg-[var(--superficie-2)] px-1.5 py-0.5 text-xs">
                  {item.shortcut}
                </code>
                {item.category && <Etiqueta cor="#64748B">{item.category}</Etiqueta>}
                {!item.isActive && <Etiqueta cor="#DC2626">Inativa</Etiqueta>}
              </div>
              <p className="mt-1.5 text-sm whitespace-pre-wrap text-[var(--texto-2)]">
                {item.content}
              </p>
            </Cartao>
          </li>
        ))}
      </ul>

      {podeGerenciar && (
        <ModalNovaResposta
          aberto={modal}
          aoFechar={() => setModal(false)}
          aoSalvar={async () => {
            setModal(false);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function ModalNovaResposta({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
}) {
  const [titulo, setTitulo] = useState("");
  const [atalho, setAtalho] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [previa, setPrevia] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function prever() {
    try {
      const dados = await api<{ preview: string; missing: string[] }>(
        "/api/quick-replies",
        {
          method: "POST",
          json: {
            action: "preview",
            content: conteudo,
            variables: {
              nome_cliente: "Ana Ribeiro",
              primeiro_nome_cliente: "Ana",
              nome_vendedor: "Você",
              nome_empresa: "Sua empresa",
              horario_atendimento: "Segunda a sexta, 08:00 às 18:00",
              telefone_cliente: "(11) 90000-0000",
              data_hoje: new Date().toLocaleDateString("pt-BR"),
            },
          },
        },
      );
      setPrevia(
        dados.missing.length > 0
          ? `${dados.preview}\n\n(Variáveis sem valor: ${dados.missing.join(", ")})`
          : dados.preview,
      );
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await api("/api/quick-replies", {
        method: "POST",
        json: {
          action: "create",
          title: titulo,
          shortcut: atalho,
          content: conteudo,
          category: categoria || undefined,
        },
      });
      setTitulo("");
      setAtalho("");
      setConteudo("");
      setCategoria("");
      setPrevia(null);
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
      titulo="Nova resposta rápida"
      rodape={
        <>
          <Botao variante="contorno" onClick={prever}>
            Pré-visualizar
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
          rotulo="Título"
          obrigatorio
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />
        <Campo
          rotulo="Atalho"
          obrigatorio
          value={atalho}
          onChange={(e) => setAtalho(e.target.value)}
          placeholder="/orcamento"
        />
        <Campo
          rotulo="Categoria"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        />
        <AreaTexto
          rotulo="Texto"
          obrigatorio
          value={conteudo}
          onChange={(e) => setConteudo(e.target.value)}
          className="min-h-32"
        />
        {previa && (
          <div className="rounded-lg border border-[var(--borda)] bg-[var(--superficie-2)] p-3">
            <p className="mb-1 text-xs font-semibold text-[var(--texto-2)]">
              Pré-visualização
            </p>
            <p className="text-sm whitespace-pre-wrap">{previa}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SecaoMarcadores({ podeGerenciar }: { podeGerenciar: boolean }) {
  const toast = useToast();
  const [itens, setItens] = useState<
    { id: string; name: string; color: string; isActive: boolean; usageCount: number }[]
  >([]);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState("#16A34A");
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const dados = await api<{ items: typeof itens }>("/api/tags?includeInactive=true");
      setItens(dados.items);
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar() {
    if (!nome.trim()) return;
    try {
      await api("/api/tags", { method: "POST", json: { name: nome, color: cor } });
      setNome("");
      await carregar();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  if (carregando) return <Esqueleto className="h-48 rounded-xl" />;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h2 className="text-base font-semibold">Marcadores</h2>

      {podeGerenciar && (
        <Cartao>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <Campo
                rotulo="Nome do marcador"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Aguardando pagamento"
              />
            </div>
            <Campo
              rotulo="Cor"
              type="color"
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              className="h-11 w-20 p-1"
            />
            <Botao onClick={criar}>Criar</Botao>
          </div>
        </Cartao>
      )}

      <div className="flex flex-wrap gap-2">
        {itens.map((marcador) => (
          <Etiqueta key={marcador.id} cor={marcador.color}>
            {marcador.name}
            <span className="opacity-70">({marcador.usageCount})</span>
          </Etiqueta>
        ))}
      </div>
    </div>
  );
}

function SecaoNotificacoes() {
  const { preferencias, definirPreferencias } = useSessao();
  return (
    <Cartao className="max-w-2xl">
      <h2 className="mb-4 text-base font-semibold">Preferências de notificação</h2>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={preferencias.notificationSound}
            onChange={(e) =>
              definirPreferencias({ notificationSound: e.target.checked })
            }
            className="size-4 rounded accent-[var(--primaria)]"
          />
          Tocar som ao receber notificação
        </label>
        <p className="text-sm text-[var(--texto-2)]">
          As notificações internas (sino) estão sempre ativas. Para receber
          alertas no celular, instale o PRICALL como aplicativo pelo menu do
          navegador.
        </p>
      </div>
    </Cartao>
  );
}

function SecaoIa({
  config,
  salvando,
  aoSalvar,
}: {
  config: Configuracoes;
  salvando: boolean;
  aoSalvar: (p: Partial<Configuracoes>) => void;
}) {
  const [ia, setIa] = useState(config.settings.aiEnabled ?? true);
  const [resumo, setResumo] = useState(config.settings.aiSummaryEnabled ?? true);

  return (
    <Cartao className="max-w-2xl">
      <h2 className="mb-1 text-base font-semibold">Inteligência artificial</h2>
      <p className="mb-4 text-sm text-[var(--texto-2)]">
        A IA é sempre assistiva: sugere, mas nunca envia mensagem sozinha nem
        toma decisões pela equipe. Apenas o contexto necessário é enviado, com
        CPF, CNPJ, e-mail e telefone mascarados.
      </p>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={ia}
            onChange={(e) => setIa(e.target.checked)}
            className="size-4 rounded accent-[var(--primaria)]"
          />
          Habilitar sugestão de resposta e classificação
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={resumo}
            onChange={(e) => setResumo(e.target.checked)}
            className="size-4 rounded accent-[var(--primaria)]"
          />
          Habilitar resumo da conversa
        </label>

        <Botao
          className="self-start"
          carregando={salvando}
          onClick={() =>
            aoSalvar({
              settings: { ...config.settings, aiEnabled: ia, aiSummaryEnabled: resumo },
            })
          }
        >
          Salvar
        </Botao>
      </div>
    </Cartao>
  );
}

function SecaoAparencia({
  preferencias,
  definirPreferencias,
  config,
  podeGerenciar,
  aoSalvar,
}: {
  preferencias: ReturnType<typeof useSessao>["preferencias"];
  definirPreferencias: ReturnType<typeof useSessao>["definirPreferencias"];
  config: Configuracoes;
  podeGerenciar: boolean;
  aoSalvar: (p: Partial<Configuracoes>) => void;
}) {
  const [cor, setCor] = useState(config.branding.primaryColor ?? "#16A34A");
  const [nomeCentral, setNomeCentral] = useState(
    config.branding.inboxName ?? "Central de atendimento",
  );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Cartao>
        <h2 className="mb-4 text-base font-semibold">Preferências pessoais</h2>
        <div className="flex flex-col gap-4">
          <Selecao
            rotulo="Tema"
            value={preferencias.theme}
            onChange={(e) =>
              definirPreferencias({
                theme: e.target.value as "light" | "dark" | "system",
              })
            }
          >
            <option value="system">Seguir o sistema</option>
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </Selecao>

          <Selecao
            rotulo="Densidade de visualização"
            value={preferencias.density}
            onChange={(e) =>
              definirPreferencias({
                density: e.target.value as "compact" | "comfortable",
              })
            }
          >
            <option value="comfortable">Confortável</option>
            <option value="compact">Compacta</option>
          </Selecao>

          <Selecao
            rotulo="Tamanho da fonte"
            value={String(preferencias.fontScale)}
            onChange={(e) =>
              definirPreferencias({ fontScale: Number(e.target.value) })
            }
          >
            <option value="0.9">Pequena</option>
            <option value="1">Padrão</option>
            <option value="1.15">Grande</option>
            <option value="1.3">Muito grande</option>
          </Selecao>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={preferencias.reduceMotion}
              onChange={(e) => definirPreferencias({ reduceMotion: e.target.checked })}
              className="size-4 rounded accent-[var(--primaria)]"
            />
            Reduzir animações
          </label>
        </div>
      </Cartao>

      {podeGerenciar && (
        <Cartao>
          <h2 className="mb-4 text-base font-semibold">Identidade da empresa</h2>
          <div className="flex flex-col gap-4">
            <Campo
              rotulo="Nome da central"
              value={nomeCentral}
              onChange={(e) => setNomeCentral(e.target.value)}
            />
            <Campo
              rotulo="Cor principal"
              type="color"
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              className="h-11 w-24 p-1"
            />
            <Botao
              className="self-start"
              onClick={() =>
                aoSalvar({
                  branding: { primaryColor: cor, inboxName: nomeCentral },
                })
              }
            >
              Salvar identidade
            </Botao>
          </div>
        </Cartao>
      )}
    </div>
  );
}

function SecaoSeguranca({
  config,
  salvando,
  aoSalvar,
}: {
  config: Configuracoes;
  salvando: boolean;
  aoSalvar: (p: Partial<Configuracoes>) => void;
}) {
  const [mascarar, setMascarar] = useState(
    config.settings.maskPhoneForSellers ?? false,
  );
  const [retencao, setRetencao] = useState(config.settings.dataRetentionDays ?? 365);

  return (
    <Cartao className="max-w-2xl">
      <h2 className="mb-1 text-base font-semibold">Segurança e privacidade</h2>
      <p className="mb-4 text-sm text-[var(--texto-2)]">
        Configurações pensadas para os princípios da LGPD: acesso mínimo
        necessário, mascaramento de dados sensíveis e retenção controlada.
      </p>

      <div className="flex flex-col gap-4">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={mascarar}
            onChange={(e) => setMascarar(e.target.checked)}
            className="mt-0.5 size-4 rounded accent-[var(--primaria)]"
          />
          <span>
            Mascarar telefone para vendedores
            <span className="block text-xs text-[var(--texto-2)]">
              Vendedores veem apenas DDI, DDD e os dois últimos dígitos.
              Administradores e supervisores continuam vendo o número completo.
            </span>
          </span>
        </label>

        <Campo
          rotulo="Retenção de dados (dias)"
          type="number"
          min={30}
          max={3650}
          dica="Prazo de guarda das conversas encerradas antes do expurgo."
          value={retencao}
          onChange={(e) => setRetencao(Number(e.target.value))}
        />

        <Aviso tipo="info">
          Todas as ações sensíveis — login, transferências, encerramentos,
          exportações e alterações de permissão — ficam registradas no log de
          auditoria, com IP e navegador.
        </Aviso>

        <Botao
          className="self-start"
          carregando={salvando}
          onClick={() =>
            aoSalvar({
              settings: {
                ...config.settings,
                maskPhoneForSellers: mascarar,
                dataRetentionDays: retencao,
              },
            })
          }
        >
          Salvar
        </Botao>
      </div>
    </Cartao>
  );
}

function SecaoSaude({ podeReprocessar }: { podeReprocessar: boolean }) {
  const toast = useToast();
  const [dados, setDados] = useState<Saude | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      setDados(await api<Saude>("/api/health"));
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function reprocessar(eventId: string) {
    try {
      const resultado = await api<{ ok: boolean; detail: string }>(
        "/api/health/retry",
        { method: "POST", json: { eventId } },
      );
      toast.mostrar(resultado.ok ? "sucesso" : "erro", resultado.detail);
      await carregar();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  if (carregando || !dados) return <Esqueleto className="h-64 rounded-xl" />;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h2 className="text-base font-semibold">Integridade da integração</h2>
      <p className="text-sm text-[var(--texto-2)]">Métricas dos últimos 7 dias.</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica rotulo="Webhooks recebidos" valor={dados.events.received} />
        <Metrica rotulo="Processados" valor={dados.events.processed} />
        <Metrica
          rotulo="Com falha"
          valor={dados.events.failed}
          alerta={dados.events.failed > 0}
        />
        <Metrica rotulo="Pendentes" valor={dados.events.pending} />
        <Metrica rotulo="Mensagens enviadas" valor={dados.messages.sent} />
        <Metrica rotulo="Entregues" valor={dados.messages.delivered} />
        <Metrica
          rotulo="Falhas de envio"
          valor={dados.messages.failed}
          alerta={dados.messages.failed > 0}
        />
        <Metrica rotulo="Conversas abertas" valor={dados.openConversations} />
      </div>

      <Cartao>
        <h3 className="mb-3 text-sm font-semibold">Últimos erros</h3>
        {dados.recentErrors.length === 0 ? (
          <p className="text-sm text-[var(--texto-2)]">
            Nenhum erro de integração registrado.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dados.recentErrors.map((erro) => (
              <li
                key={erro.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--borda)] p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {erro.provider} · {erro.eventType}
                  </p>
                  <p className="text-xs text-[var(--color-erro)]">
                    {erro.errorMessage}
                  </p>
                  <p className="text-xs text-[var(--texto-3)]">
                    {formatarDataHora(erro.receivedAt)} · {erro.attemptCount}{" "}
                    tentativa(s)
                  </p>
                </div>
                {podeReprocessar && (
                  <Botao
                    variante="contorno"
                    tamanho="pequeno"
                    onClick={() => void reprocessar(erro.id)}
                  >
                    Reprocessar
                  </Botao>
                )}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}

function Metrica({
  rotulo,
  valor,
  alerta,
}: {
  rotulo: string;
  valor: number;
  alerta?: boolean;
}) {
  return (
    <Cartao className={cn(alerta && "border-[var(--color-erro)]/40")}>
      <p className="text-xs font-medium text-[var(--texto-2)]">{rotulo}</p>
      <p
        className={cn(
          "mt-1 text-xl font-bold tabular-nums",
          alerta && "text-[var(--color-erro)]",
        )}
      >
        {valor}
      </p>
    </Cartao>
  );
}

export { ROTULOS_DISPONIBILIDADE };
