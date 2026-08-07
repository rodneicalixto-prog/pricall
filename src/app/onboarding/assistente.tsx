"use client";

/** Assistente de configuração inicial, em cinco etapas. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft } from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { DAY_KEYS, DAY_LABELS, DEFAULT_BUSINESS_HOURS } from "@/lib/business-hours";
import { Aviso, Botao, Campo, Cartao, Selecao } from "@/components/ui";
import { Logotipo } from "@/components/logotipo";

type Etapa = "company" | "team" | "whatsapp" | "assignment" | "finish";

const ETAPAS: { chave: Etapa; titulo: string }[] = [
  { chave: "company", titulo: "Dados da empresa" },
  { chave: "team", titulo: "Equipe" },
  { chave: "whatsapp", titulo: "WhatsApp" },
  { chave: "assignment", titulo: "Distribuição" },
  { chave: "finish", titulo: "Conclusão" },
];

type Convite = { name: string; email: string; role: "supervisor" | "seller"; teamName: string };

export function AssistenteOnboarding({
  nomeInicial,
  segmentoInicial,
}: {
  nomeInicial: string;
  segmentoInicial: string;
}) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>("company");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [linksConvite, setLinksConvite] = useState<{ email: string; link: string }[]>([]);

  // Etapa 1
  const [nome, setNome] = useState(nomeInicial);
  const [segmento, setSegmento] = useState(segmentoInicial);
  const [fuso, setFuso] = useState("America/Sao_Paulo");
  const [horarios, setHorarios] =
    useState<Record<string, { start: string; end: string }[]>>(DEFAULT_BUSINESS_HOURS);

  // Etapa 2
  const [equipes, setEquipes] = useState<string[]>(["Vendas"]);
  const [convites, setConvites] = useState<Convite[]>([]);

  // Etapa 3
  const [modoWhatsapp, setModoWhatsapp] = useState<"demo" | "cloud_api" | "evolution">("demo");
  const [rotulo, setRotulo] = useState("Número principal");
  const [numeroExibido, setNumeroExibido] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [urlEvolution, setUrlEvolution] = useState("");
  const [instancia, setInstancia] = useState("");
  const [referenciaSegredo, setReferenciaSegredo] = useState("");

  // Etapa 4
  const [estrategia, setEstrategia] = useState<
    "manual" | "round_robin" | "least_active" | "team_based" | "first_available"
  >("least_active");
  const [exigirOnline, setExigirOnline] = useState(true);

  const indiceAtual = ETAPAS.findIndex((e) => e.chave === etapa);

  async function enviarEtapa(corpo: Record<string, unknown>) {
    setErro(null);
    setEnviando(true);
    try {
      return await api<{ next?: Etapa; redirectTo?: string; invitations?: typeof linksConvite }>(
        "/api/onboarding",
        { method: "POST", json: corpo },
      );
    } catch (error) {
      setErro(mensagemDeErro(error));
      return null;
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main
      id="conteudo-principal"
      className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-5 py-10"
    >
      <div className="flex justify-center">
        <Logotipo tamanho="grande" />
      </div>

      <ol className="flex items-center justify-between gap-1" aria-label="Etapas">
        {ETAPAS.map((item, indice) => (
          <li key={item.chave} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full text-xs font-bold",
                indice < indiceAtual
                  ? "bg-[var(--primaria)] text-white"
                  : indice === indiceAtual
                    ? "border-2 border-[var(--primaria)] text-[var(--primaria)]"
                    : "bg-[var(--superficie-2)] text-[var(--texto-3)]",
              )}
              aria-current={indice === indiceAtual ? "step" : undefined}
            >
              {indice < indiceAtual ? <Check className="size-4" aria-hidden /> : indice + 1}
            </span>
            <span className="hidden text-center text-[11px] text-[var(--texto-2)] sm:block">
              {item.titulo}
            </span>
          </li>
        ))}
      </ol>

      <Cartao>
        {erro && (
          <div className="mb-4">
            <Aviso tipo="erro">{erro}</Aviso>
          </div>
        )}

        {etapa === "company" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">Confirme os dados da empresa</h1>
            <Campo rotulo="Nome da empresa" obrigatorio value={nome} onChange={(e) => setNome(e.target.value)} />
            <Campo rotulo="Segmento" obrigatorio value={segmento} onChange={(e) => setSegmento(e.target.value)} />
            <Selecao rotulo="Fuso horário" value={fuso} onChange={(e) => setFuso(e.target.value)}>
              <option value="America/Sao_Paulo">Brasília (America/Sao_Paulo)</option>
              <option value="America/Manaus">Manaus (America/Manaus)</option>
              <option value="America/Belem">Belém (America/Belem)</option>
              <option value="America/Cuiaba">Cuiabá (America/Cuiaba)</option>
              <option value="America/Rio_Branco">Rio Branco (America/Rio_Branco)</option>
            </Selecao>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Horário de funcionamento</legend>
              <div className="flex flex-col gap-2">
                {DAY_KEYS.map((dia) => {
                  const faixas = horarios[dia] ?? [];
                  const ativo = faixas.length > 0;
                  return (
                    <div key={dia} className="flex flex-wrap items-center gap-2">
                      <label className="flex w-36 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={ativo}
                          onChange={(e) =>
                            setHorarios((atual) => ({
                              ...atual,
                              [dia]: e.target.checked ? [{ start: "08:00", end: "18:00" }] : [],
                            }))
                          }
                          className="size-4 rounded accent-[var(--primaria)]"
                        />
                        {DAY_LABELS[dia].replace("-feira", "")}
                      </label>
                      {ativo && (
                        <>
                          <input
                            type="time"
                            aria-label={`Início ${DAY_LABELS[dia]}`}
                            value={faixas[0].start}
                            onChange={(e) =>
                              setHorarios((atual) => ({
                                ...atual,
                                [dia]: [{ ...faixas[0], start: e.target.value }],
                              }))
                            }
                            className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
                          />
                          <span className="text-sm">às</span>
                          <input
                            type="time"
                            aria-label={`Término ${DAY_LABELS[dia]}`}
                            value={faixas[0].end}
                            onChange={(e) =>
                              setHorarios((atual) => ({
                                ...atual,
                                [dia]: [{ ...faixas[0], end: e.target.value }],
                              }))
                            }
                            className="min-h-10 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-sm"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <Botao
              carregando={enviando}
              onClick={async () => {
                const r = await enviarEtapa({
                  step: "company",
                  name: nome,
                  segment: segmento,
                  timezone: fuso,
                  businessHours: horarios,
                });
                if (r) setEtapa("team");
              }}
            >
              Continuar
            </Botao>
          </div>
        )}

        {etapa === "team" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">Monte sua equipe</h1>
            <p className="text-sm text-[var(--texto-2)]">
              Crie os setores da empresa e convide os vendedores. Você pode
              pular esta etapa e fazer isso depois.
            </p>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Setores</legend>
              <div className="flex flex-col gap-2">
                {equipes.map((equipe, indice) => (
                  <div key={indice} className="flex gap-2">
                    <input
                      value={equipe}
                      aria-label={`Nome do setor ${indice + 1}`}
                      onChange={(e) =>
                        setEquipes(equipes.map((v, i) => (i === indice ? e.target.value : v)))
                      }
                      className="min-h-11 flex-1 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-3 text-sm"
                    />
                    <Botao
                      variante="contorno"
                      onClick={() => setEquipes(equipes.filter((_, i) => i !== indice))}
                    >
                      Remover
                    </Botao>
                  </div>
                ))}
                <Botao
                  variante="contorno"
                  tamanho="pequeno"
                  className="self-start"
                  onClick={() => setEquipes([...equipes, ""])}
                >
                  Adicionar setor
                </Botao>
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Convidar vendedores</legend>
              <div className="flex flex-col gap-3">
                {convites.map((convite, indice) => (
                  <div key={indice} className="grid gap-2 rounded-lg border border-[var(--borda)] p-3 sm:grid-cols-2">
                    <Campo
                      rotulo="Nome"
                      value={convite.name}
                      onChange={(e) =>
                        setConvites(
                          convites.map((c, i) => (i === indice ? { ...c, name: e.target.value } : c)),
                        )
                      }
                    />
                    <Campo
                      rotulo="E-mail"
                      type="email"
                      value={convite.email}
                      onChange={(e) =>
                        setConvites(
                          convites.map((c, i) => (i === indice ? { ...c, email: e.target.value } : c)),
                        )
                      }
                    />
                    <Selecao
                      rotulo="Função"
                      value={convite.role}
                      onChange={(e) =>
                        setConvites(
                          convites.map((c, i) =>
                            i === indice ? { ...c, role: e.target.value as Convite["role"] } : c,
                          ),
                        )
                      }
                    >
                      <option value="seller">Vendedor</option>
                      <option value="supervisor">Supervisor</option>
                    </Selecao>
                    <Selecao
                      rotulo="Setor"
                      value={convite.teamName}
                      onChange={(e) =>
                        setConvites(
                          convites.map((c, i) =>
                            i === indice ? { ...c, teamName: e.target.value } : c,
                          ),
                        )
                      }
                    >
                      <option value="">Sem setor</option>
                      {equipes.filter(Boolean).map((equipe) => (
                        <option key={equipe} value={equipe}>
                          {equipe}
                        </option>
                      ))}
                    </Selecao>
                    <div className="sm:col-span-2">
                      <Botao
                        variante="contorno"
                        tamanho="pequeno"
                        onClick={() => setConvites(convites.filter((_, i) => i !== indice))}
                      >
                        Remover convite
                      </Botao>
                    </div>
                  </div>
                ))}
                <Botao
                  variante="contorno"
                  tamanho="pequeno"
                  className="self-start"
                  onClick={() =>
                    setConvites([
                      ...convites,
                      { name: "", email: "", role: "seller", teamName: equipes[0] ?? "" },
                    ])
                  }
                >
                  Adicionar convite
                </Botao>
              </div>
            </fieldset>

            {linksConvite.length > 0 && (
              <Aviso tipo="sucesso">
                <p className="mb-1 font-semibold">Convites gerados</p>
                <ul className="flex flex-col gap-1 text-xs break-all">
                  {linksConvite.map((c) => (
                    <li key={c.email}>
                      <strong>{c.email}</strong>: {c.link}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs">
                  Envie estes links para os vendedores definirem a senha.
                </p>
              </Aviso>
            )}

            <div className="flex gap-2">
              <Botao variante="contorno" onClick={() => setEtapa("company")}>
                <ChevronLeft className="size-4" aria-hidden /> Voltar
              </Botao>
              <Botao
                carregando={enviando}
                onClick={async () => {
                  const r = await enviarEtapa({
                    step: "team",
                    teams: equipes.filter(Boolean).map((name) => ({ name })),
                    invites: convites
                      .filter((c) => c.name && c.email)
                      .map((c) => ({
                        name: c.name,
                        email: c.email,
                        role: c.role,
                        teamName: c.teamName || undefined,
                      })),
                  });
                  if (r) {
                    setLinksConvite(r.invitations ?? []);
                    setEtapa("whatsapp");
                  }
                }}
              >
                Continuar
              </Botao>
            </div>
          </div>
        )}

        {etapa === "whatsapp" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">Conectar o WhatsApp</h1>
            <Aviso tipo="info">
              A integração usa a plataforma oficial do WhatsApp Business (Cloud
              API) ou a Evolution API. Você pode começar em modo demonstração e
              conectar o número real depois.
            </Aviso>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Como você quer começar?</legend>
              {(
                [
                  ["demo", "Ambiente de demonstração", "Contatos e mensagens fictícias para testar tudo sem credenciais."],
                  ["cloud_api", "API oficial do WhatsApp Business", "Requer phone_number_id e token da Meta."],
                  ["evolution", "Evolution API", "Requer URL, instância e chave da sua Evolution."],
                ] as const
              ).map(([valor, titulo, descricao]) => (
                <label
                  key={valor}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--borda)] p-3 has-checked:border-[var(--primaria)] has-checked:bg-[var(--primaria)]/8"
                >
                  <input
                    type="radio"
                    name="modo"
                    checked={modoWhatsapp === valor}
                    onChange={() => setModoWhatsapp(valor)}
                    className="mt-0.5 accent-[var(--primaria)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{titulo}</span>
                    <span className="block text-xs text-[var(--texto-2)]">{descricao}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {modoWhatsapp !== "demo" && (
              <div className="flex flex-col gap-3 rounded-lg border border-[var(--borda)] p-3">
                <Campo rotulo="Identificação do número" value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
                <Campo
                  rotulo="Número exibido"
                  value={numeroExibido}
                  onChange={(e) => setNumeroExibido(e.target.value)}
                  placeholder="+55 (11) 3000-0000"
                />
                {modoWhatsapp === "cloud_api" ? (
                  <>
                    <Campo
                      rotulo="phone_number_id"
                      obrigatorio
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                    />
                    <Campo
                      rotulo="WhatsApp Business Account ID"
                      value={wabaId}
                      onChange={(e) => setWabaId(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <Campo
                      rotulo="URL da Evolution API"
                      obrigatorio
                      type="url"
                      value={urlEvolution}
                      onChange={(e) => setUrlEvolution(e.target.value)}
                    />
                    <Campo
                      rotulo="Nome da instância"
                      obrigatorio
                      value={instancia}
                      onChange={(e) => setInstancia(e.target.value)}
                    />
                  </>
                )}
                <Campo
                  rotulo="Referência ao segredo"
                  value={referenciaSegredo}
                  onChange={(e) => setReferenciaSegredo(e.target.value)}
                  placeholder={
                    modoWhatsapp === "cloud_api"
                      ? "env:WHATSAPP_ACCESS_TOKEN"
                      : "env:EVOLUTION_API_KEY"
                  }
                  dica="Nome da variável de ambiente que guarda o token. O token nunca é salvo no banco."
                />
              </div>
            )}

            <div className="flex gap-2">
              <Botao variante="contorno" onClick={() => setEtapa("team")}>
                <ChevronLeft className="size-4" aria-hidden /> Voltar
              </Botao>
              <Botao
                carregando={enviando}
                onClick={async () => {
                  const r = await enviarEtapa({
                    step: "whatsapp",
                    mode: modoWhatsapp,
                    label: rotulo,
                    displayPhoneNumber: numeroExibido || undefined,
                    phoneNumberId: phoneNumberId || undefined,
                    whatsappBusinessAccountId: wabaId || undefined,
                    apiBaseUrl: urlEvolution || undefined,
                    instanceName: instancia || undefined,
                    tokenReference: referenciaSegredo || undefined,
                  });
                  if (r) setEtapa("assignment");
                }}
              >
                Continuar
              </Botao>
            </div>
          </div>
        )}

        {etapa === "assignment" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">Como distribuir as conversas?</h1>

            <fieldset className="flex flex-col gap-2">
              <legend className="apenas-leitor-tela">Estratégia de distribuição</legend>
              {(
                [
                  ["manual", "Distribuição manual", "Todas as conversas entram na fila 'Não atribuídos'."],
                  ["round_robin", "Rodízio automático", "Distribui em sequência entre os vendedores online."],
                  ["least_active", "Menor número de atendimentos ativos", "Atribui a quem estiver com menos conversas."],
                  ["team_based", "Vendedor por setor", "Direciona pelo setor, número ou palavra-chave."],
                  ["first_available", "Primeiro vendedor disponível", "Notifica todos; fica com quem assumir primeiro."],
                ] as const
              ).map(([valor, titulo, descricao]) => (
                <label
                  key={valor}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--borda)] p-3 has-checked:border-[var(--primaria)] has-checked:bg-[var(--primaria)]/8"
                >
                  <input
                    type="radio"
                    name="estrategia"
                    checked={estrategia === valor}
                    onChange={() => setEstrategia(valor)}
                    className="mt-0.5 accent-[var(--primaria)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{titulo}</span>
                    <span className="block text-xs text-[var(--texto-2)]">{descricao}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={exigirOnline}
                onChange={(e) => setExigirOnline(e.target.checked)}
                className="size-4 rounded accent-[var(--primaria)]"
              />
              Distribuir apenas para vendedores online
            </label>

            <div className="flex gap-2">
              <Botao variante="contorno" onClick={() => setEtapa("whatsapp")}>
                <ChevronLeft className="size-4" aria-hidden /> Voltar
              </Botao>
              <Botao
                carregando={enviando}
                onClick={async () => {
                  const r = await enviarEtapa({
                    step: "assignment",
                    strategy: estrategia,
                    requireOnline: exigirOnline,
                  });
                  if (r) setEtapa("finish");
                }}
              >
                Continuar
              </Botao>
            </div>
          </div>
        )}

        {etapa === "finish" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">Tudo pronto!</h1>
            <ul className="flex flex-col gap-2">
              {[
                "Dados da empresa e horário de funcionamento configurados",
                "Setores criados e convites gerados",
                "WhatsApp conectado",
                "Regra de distribuição definida",
                "Marcadores e respostas rápidas iniciais criados",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm">
                  <Check className="size-4 shrink-0 text-[var(--primaria)]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>

            <Botao
              carregando={enviando}
              onClick={async () => {
                const r = await enviarEtapa({ step: "finish" });
                if (r) {
                  router.push(r.redirectTo ?? "/atendimentos");
                  router.refresh();
                }
              }}
            >
              Ir para a central de atendimento
            </Botao>
          </div>
        )}
      </Cartao>
    </main>
  );
}
