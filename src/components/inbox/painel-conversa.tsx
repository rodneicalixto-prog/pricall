"use client";

/**
 * Coluna direita: a conversa em si.
 * Cabeçalho com ações, histórico paginado com separação por data, indicadores
 * de envio/entrega/leitura/falha, presença de outros vendedores e composição
 * com respostas rápidas, emoji, anexo e sugestão de IA.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Eye,
  Info,
  Loader2,
  PanelRightOpen,
  Paperclip,
  RefreshCw,
  Send,
  Smile,
  Sparkles,
  UserPlus,
  Zap,
} from "lucide-react";
import { api, mensagemDeErro } from "@/lib/api-client";
import {
  cn,
  formatarDataHora,
  formatarHora,
  ROTULOS_ENVIO,
  ROTULOS_STATUS,
} from "@/lib/utils";
import {
  Aviso,
  Botao,
  Esqueleto,
  EstadoErro,
  EstadoVazio,
  Etiqueta,
  EtiquetaPrioridade,
  useToast,
} from "@/components/ui";
import { useSessao } from "@/components/app/sessao";
import { useEventoTempoReal } from "@/components/app/tempo-real";
import type { DetalheConversa, Mensagem, RespostaRapida } from "./tipos";
import { ModalTransferencia } from "./modal-transferencia";
import { ModalEncerramento } from "./modal-encerramento";

const EMOJIS = [
  "😀", "😁", "😊", "🙂", "😉", "😍", "🤝", "👍", "👏", "🙏",
  "💪", "🔥", "✅", "❌", "⚠️", "📦", "🚚", "💰", "📄", "📞",
  "🕐", "📍", "🎯", "⭐",
];

const EVENTOS_MENSAGEM = ["message.created", "message.status"];
const EVENTOS_CONVERSA = ["conversation.updated", "conversation.assigned", "conversation.closed"];
const EVENTOS_PRESENCA = ["presence.updated"];

export function PainelConversa({
  conversaId,
  aoVoltar,
  aoAbrirContato,
  aoMudar,
}: {
  conversaId: string;
  aoVoltar?: () => void;
  aoAbrirContato?: () => void;
  aoMudar?: () => void;
}) {
  const { usuario, organizacao } = useSessao();
  const toast = useToast();

  const [detalhe, setDetalhe] = useState<DetalheConversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [origemIa, setOrigemIa] = useState(false);

  const [visualizadores, setVisualizadores] = useState<
    { userId: string; userName: string; isTyping: boolean }[]
  >([]);
  const [respostas, setRespostas] = useState<RespostaRapida[]>([]);
  const [mostrarRespostas, setMostrarRespostas] = useState(false);
  const [mostrarEmojis, setMostrarEmojis] = useState(false);
  const [modalTransferencia, setModalTransferencia] = useState(false);
  const [modalEncerramento, setModalEncerramento] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [resumo, setResumo] = useState<string | null>(null);

  const areaMensagens = useRef<HTMLDivElement>(null);
  const campoTexto = useRef<HTMLTextAreaElement>(null);
  const rolarAoFim = useRef(true);

  /* ------------------------- Carregamento ------------------------- */

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [detalheDados, mensagensDados] = await Promise.all([
        api<DetalheConversa>(`/api/conversations/${conversaId}`),
        api<{ items: Mensagem[]; nextCursor: string | null }>(
          `/api/conversations/${conversaId}/messages?limit=40`,
        ),
      ]);
      setDetalhe(detalheDados);
      setMensagens(mensagensDados.items);
      setCursor(mensagensDados.nextCursor);
      rolarAoFim.current = true;
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setCarregando(false);
    }
  }, [conversaId]);

  useEffect(() => {
    setTexto("");
    setErroEnvio(null);
    setResumo(null);
    void carregar();
  }, [carregar]);

  // Marca como lida e registra presença ao abrir.
  useEffect(() => {
    void api(`/api/conversations/${conversaId}/read`, { method: "POST" }).catch(
      () => {},
    );
    void api<{ viewers: typeof visualizadores }>(
      `/api/conversations/${conversaId}/presence`,
      { method: "POST", json: { isTyping: false } },
    )
      .then((d) => setVisualizadores(d.viewers))
      .catch(() => {});

    const intervalo = setInterval(() => {
      void api<{ viewers: typeof visualizadores }>(
        `/api/conversations/${conversaId}/presence`,
        { method: "POST", json: { isTyping: false } },
      )
        .then((d) => setVisualizadores(d.viewers))
        .catch(() => {});
    }, 20_000);

    return () => {
      clearInterval(intervalo);
      void api(`/api/conversations/${conversaId}/presence`, {
        method: "DELETE",
      }).catch(() => {});
    };
  }, [conversaId]);

  useEffect(() => {
    void api<{ items: RespostaRapida[] }>("/api/quick-replies")
      .then((d) => setRespostas(d.items))
      .catch(() => {});
  }, []);

  /* ------------------------- Tempo real ------------------------- */

  useEventoTempoReal(EVENTOS_MENSAGEM, (evento) => {
    if (evento.conversationId !== conversaId) return;
    void api<{ items: Mensagem[]; nextCursor: string | null }>(
      `/api/conversations/${conversaId}/messages?limit=40`,
    )
      .then((d) => {
        setMensagens(d.items);
        setCursor(d.nextCursor);
        if (evento.type === "message.created") {
          rolarAoFim.current = true;
          void api(`/api/conversations/${conversaId}/read`, { method: "POST" });
        }
      })
      .catch(() => {});
  });

  useEventoTempoReal(EVENTOS_CONVERSA, (evento) => {
    if (evento.conversationId !== conversaId) return;
    void api<DetalheConversa>(`/api/conversations/${conversaId}`)
      .then(setDetalhe)
      .catch(() => {});
  });

  useEventoTempoReal(EVENTOS_PRESENCA, (evento) => {
    if (evento.conversationId !== conversaId) return;
    if (evento.userId === usuario.id) return;
    void api<{ viewers: typeof visualizadores }>(
      `/api/conversations/${conversaId}/presence`,
    )
      .then((d) => setVisualizadores(d.viewers))
      .catch(() => {});
  });

  // Rola até o fim quando chega mensagem nova (mas não ao carregar histórico).
  useEffect(() => {
    if (!rolarAoFim.current) return;
    const area = areaMensagens.current;
    if (area) area.scrollTop = area.scrollHeight;
    rolarAoFim.current = false;
  }, [mensagens]);

  async function carregarAnteriores() {
    if (!cursor || carregandoAnteriores) return;
    setCarregandoAnteriores(true);
    const area = areaMensagens.current;
    const alturaAnterior = area?.scrollHeight ?? 0;
    try {
      const dados = await api<{ items: Mensagem[]; nextCursor: string | null }>(
        `/api/conversations/${conversaId}/messages?limit=40&cursor=${encodeURIComponent(cursor)}`,
      );
      setMensagens((atual) => [...dados.items, ...atual]);
      setCursor(dados.nextCursor);
      // Mantém a posição visual de leitura.
      requestAnimationFrame(() => {
        if (area) area.scrollTop = area.scrollHeight - alturaAnterior;
      });
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setCarregandoAnteriores(false);
    }
  }

  /* ------------------------- Ações ------------------------- */

  async function assumir() {
    try {
      await api(`/api/conversations/${conversaId}/claim`, { method: "POST" });
      toast.mostrar("sucesso", "Atendimento assumido.");
      await carregar();
      aoMudar?.();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
      await carregar();
    }
  }

  async function alterarPrioridade(prioridade: string) {
    try {
      await api(`/api/conversations/${conversaId}/priority`, {
        method: "POST",
        json: { priority: prioridade },
      });
      await carregar();
      aoMudar?.();
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || enviando) return;

    setEnviando(true);
    setErroEnvio(null);
    try {
      const resultado = await api<{
        message: Mensagem;
        delivery: { ok: boolean; message?: string; retryable?: boolean };
      }>(`/api/conversations/${conversaId}/messages`, {
        method: "POST",
        json: { text: conteudo, aiSuggested: origemIa },
      });

      if (!resultado.delivery.ok) {
        // O texto NÃO é apagado: o vendedor pode tentar de novo.
        setErroEnvio(
          resultado.delivery.message ??
            "Não foi possível enviar a mensagem. Tente novamente.",
        );
      } else {
        setTexto("");
        setOrigemIa(false);
      }
      rolarAoFim.current = true;
      aoMudar?.();
    } catch (error) {
      setErroEnvio(mensagemDeErro(error));
    } finally {
      setEnviando(false);
    }
  }

  async function reenviar(mensagemId: string) {
    try {
      await api(`/api/messages/${mensagemId}/retry`, { method: "POST" });
      toast.mostrar("sucesso", "Reenvio solicitado.");
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  async function sugerirResposta() {
    setSugerindo(true);
    try {
      const dados = await api<{
        text: string;
        insufficientContext: boolean;
      }>(`/api/conversations/${conversaId}/ai`, {
        method: "POST",
        json: { action: "suggest" },
      });
      if (dados.insufficientContext) {
        toast.mostrar("info", `Contexto insuficiente: ${dados.text}`);
      } else {
        setTexto(dados.text);
        setOrigemIa(true);
        campoTexto.current?.focus();
        toast.mostrar(
          "info",
          "Sugestão inserida no campo. Revise antes de enviar.",
        );
      }
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    } finally {
      setSugerindo(false);
    }
  }

  async function gerarResumo() {
    try {
      const dados = await api<{
        reason: string;
        request: string;
        importantInfo: string[];
        pending: string[];
        nextAction: string;
      }>(`/api/conversations/${conversaId}/ai`, {
        method: "POST",
        json: { action: "summary" },
      });
      setResumo(
        [
          `Motivo do contato: ${dados.reason}`,
          `Pedido do cliente: ${dados.request}`,
          dados.importantInfo.length
            ? `Informações importantes: ${dados.importantInfo.join("; ")}`
            : "",
          dados.pending.length ? `Pendências: ${dados.pending.join("; ")}` : "",
          `Próxima ação: ${dados.nextAction}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (error) {
      toast.mostrar("erro", mensagemDeErro(error));
    }
  }

  function aplicarRespostaRapida(resposta: RespostaRapida) {
    const variaveis: Record<string, string> = {
      nome_cliente: detalhe?.contact?.name ?? "",
      primeiro_nome_cliente: (detalhe?.contact?.name ?? "").split(" ")[0] ?? "",
      nome_vendedor: usuario.name,
      nome_empresa: organizacao.name,
      telefone_cliente: detalhe?.contact?.phone ?? "",
    };
    const preenchido = resposta.content.replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (original, chave: string) => variaveis[chave] || original,
    );
    setTexto(preenchido);
    setMostrarRespostas(false);
    setOrigemIa(false);
    campoTexto.current?.focus();
  }

  /* ------------------------- Render ------------------------- */

  if (carregando) return <EsqueletoConversa />;
  if (erro) return <EstadoErro mensagem={erro} aoTentarNovamente={() => void carregar()} />;
  if (!detalhe) {
    return <EstadoVazio titulo="Selecione um atendimento para começar." />;
  }

  const { conversation, contact, assignedUser, permissions, connection } = detalhe;
  const semResponsavel = !conversation.assignedUserId;
  const minha = conversation.assignedUserId === usuario.id;
  const encerrada = conversation.status === "closed";
  const bloqueado = contact?.isBlocked ?? false;
  const digitando = visualizadores.filter((v) => v.isTyping);
  const observando = visualizadores.filter((v) => !v.isTyping);

  const grupos = agruparPorData(mensagens);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--fundo)]">
      {/* Cabeçalho */}
      <header className="flex shrink-0 flex-col gap-2 border-b border-[var(--borda)] bg-[var(--superficie)] px-3 py-2.5 lg:px-4">
        <div className="flex items-center gap-2">
          {aoVoltar && (
            <button
              type="button"
              onClick={aoVoltar}
              aria-label="Voltar para a lista de conversas"
              className="-ml-1 flex size-10 shrink-0 items-center justify-center rounded-lg text-[var(--texto-2)] hover:bg-[var(--superficie-2)] lg:hidden"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold">
                {contact?.name ?? "Contato"}
              </h2>
              {conversation.isDemo && <Etiqueta cor="#F59E0B">Demonstração</Etiqueta>}
            </div>
            <p className="truncate text-xs text-[var(--texto-2)]">
              {contact?.phone}
              {connection && ` · ${connection.label}`}
              {connection?.extension && ` (ramal ${connection.extension})`}
            </p>
          </div>

          {aoAbrirContato && (
            <button
              type="button"
              onClick={aoAbrirContato}
              aria-label="Abrir dados do cliente"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-[var(--texto-2)] hover:bg-[var(--superficie-2)]"
            >
              <PanelRightOpen className="size-5" aria-hidden />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Etiqueta cor={corStatus(conversation.status)}>
            {ROTULOS_STATUS[conversation.status]}
          </Etiqueta>
          <EtiquetaPrioridade prioridade={conversation.priority} />
          {assignedUser ? (
            <span className="text-xs text-[var(--texto-2)]">
              Responsável: <strong>{assignedUser.name}</strong>
            </span>
          ) : (
            <Etiqueta cor="#F59E0B">Sem responsável</Etiqueta>
          )}
          {conversation.assignedAt && !encerrada && (
            <span className="text-xs text-[var(--texto-3)]">
              Em atendimento desde {formatarHora(conversation.assignedAt)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {semResponsavel && !encerrada && (
            <Botao
              tamanho="pequeno"
              onClick={assumir}
              iconeEsquerda={<UserPlus className="size-3.5" aria-hidden />}
            >
              Assumir atendimento
            </Botao>
          )}
          {permissions.canTransfer && !encerrada && (
            <Botao
              variante="contorno"
              tamanho="pequeno"
              onClick={() => setModalTransferencia(true)}
            >
              Transferir
            </Botao>
          )}
          {!encerrada && (
            <select
              aria-label="Prioridade do atendimento"
              value={conversation.priority}
              onChange={(e) => void alterarPrioridade(e.target.value)}
              className="h-9 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-2 text-xs"
            >
              <option value="low">Prioridade baixa</option>
              <option value="normal">Prioridade normal</option>
              <option value="high">Prioridade alta</option>
              <option value="urgent">Urgente</option>
            </select>
          )}
          {permissions.canClose && !encerrada && (
            <Botao
              variante="contorno"
              tamanho="pequeno"
              onClick={() => setModalEncerramento(true)}
            >
              Finalizar
            </Botao>
          )}
          {organizacao.aiEnabled && (
            <Botao
              variante="sutil"
              tamanho="pequeno"
              onClick={gerarResumo}
              iconeEsquerda={<Sparkles className="size-3.5" aria-hidden />}
            >
              Resumir
            </Botao>
          )}
        </div>

        {(digitando.length > 0 || observando.length > 0) && (
          <p
            className="flex items-center gap-1.5 text-xs text-[var(--color-alerta)]"
            role="status"
          >
            <Eye className="size-3.5" aria-hidden />
            {digitando.length > 0
              ? `${digitando.map((v) => v.userName).join(", ")} está digitando nesta conversa`
              : `${observando.map((v) => v.userName).join(", ")} também está visualizando esta conversa`}
          </p>
        )}
      </header>

      {/* Histórico */}
      <div
        ref={areaMensagens}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 lg:px-6"
        role="log"
        aria-label="Histórico de mensagens"
      >
        {cursor && (
          <div className="mb-4 flex justify-center">
            <Botao
              variante="contorno"
              tamanho="pequeno"
              carregando={carregandoAnteriores}
              onClick={carregarAnteriores}
            >
              Carregar mensagens anteriores
            </Botao>
          </div>
        )}

        {resumo && (
          <div className="mb-4">
            <Aviso tipo="info">
              <p className="mb-1 font-semibold">Resumo gerado por IA</p>
              <p className="whitespace-pre-line text-sm">{resumo}</p>
              <button
                type="button"
                onClick={() => setResumo(null)}
                className="mt-2 text-xs font-medium underline"
              >
                Ocultar resumo
              </button>
            </Aviso>
          </div>
        )}

        {mensagens.length === 0 && (
          <EstadoVazio
            titulo="Nenhuma mensagem ainda"
            descricao="Envie a primeira mensagem para iniciar a conversa."
          />
        )}

        {grupos.map(([dia, itens]) => (
          <section key={dia} aria-label={dia}>
            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--borda)]" />
              <span className="rounded-full bg-[var(--superficie-2)] px-3 py-1 text-xs font-medium text-[var(--texto-2)]">
                {dia}
              </span>
              <span className="h-px flex-1 bg-[var(--borda)]" />
            </div>
            <ul className="flex flex-col gap-2">
              {itens.map((mensagem) => (
                <li key={mensagem.id}>
                  <BalaoMensagem mensagem={mensagem} aoReenviar={reenviar} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* Composição */}
      <div className="shrink-0 border-t border-[var(--borda)] bg-[var(--superficie)] px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:px-4">
        {bloqueado && (
          <Aviso tipo="alerta">
            Contato bloqueado. O envio está desativado.
          </Aviso>
        )}

        {encerrada && !bloqueado && (
          <Aviso tipo="info">
            Atendimento encerrado
            {conversation.outcome ? ` (${conversation.outcome})` : ""}. Uma nova
            mensagem do cliente reabre a conversa automaticamente.
          </Aviso>
        )}

        {!bloqueado && !encerrada && (
          <>
            {erroEnvio && (
              <div className="mb-2">
                <Aviso tipo="erro">
                  {erroEnvio} Sua mensagem continua no campo abaixo.
                </Aviso>
              </div>
            )}

            {!minha && !semResponsavel && (
              <div className="mb-2">
                <Aviso tipo="alerta">
                  Este atendimento é de {assignedUser?.name}. Ao responder, você
                  ficará como participante do histórico.
                </Aviso>
              </div>
            )}

            {mostrarRespostas && (
              <div className="mb-2 max-h-52 overflow-y-auto rounded-lg border border-[var(--borda)]">
                {respostas.length === 0 && (
                  <p className="p-3 text-sm text-[var(--texto-2)]">
                    Nenhuma resposta rápida cadastrada.
                  </p>
                )}
                {respostas.map((resposta) => (
                  <button
                    key={resposta.id}
                    type="button"
                    onClick={() => aplicarRespostaRapida(resposta)}
                    className="block w-full border-b border-[var(--borda)] p-3 text-left last:border-0 hover:bg-[var(--superficie-2)]"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {resposta.title}
                      <code className="rounded bg-[var(--superficie-2)] px-1.5 py-0.5 text-xs text-[var(--texto-2)]">
                        {resposta.shortcut}
                      </code>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--texto-2)]">
                      {resposta.content}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {mostrarEmojis && (
              <div className="mb-2 flex flex-wrap gap-1 rounded-lg border border-[var(--borda)] p-2">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      setTexto((atual) => atual + emoji);
                      campoTexto.current?.focus();
                    }}
                    className="flex size-9 items-center justify-center rounded-lg text-lg hover:bg-[var(--superficie-2)]"
                    aria-label={`Inserir ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {origemIa && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-[var(--color-informacao)]">
                <Sparkles className="size-3.5" aria-hidden />
                Texto sugerido por IA — revise antes de enviar.
              </p>
            )}

            <div className="flex items-end gap-1.5">
              <div className="flex">
                <BotaoIcone
                  rotulo="Respostas rápidas"
                  ativo={mostrarRespostas}
                  onClick={() => {
                    setMostrarRespostas((a) => !a);
                    setMostrarEmojis(false);
                  }}
                >
                  <Zap className="size-5" aria-hidden />
                </BotaoIcone>
                <BotaoIcone
                  rotulo="Emojis"
                  ativo={mostrarEmojis}
                  onClick={() => {
                    setMostrarEmojis((a) => !a);
                    setMostrarRespostas(false);
                  }}
                >
                  <Smile className="size-5" aria-hidden />
                </BotaoIcone>
                <BotaoIcone
                  rotulo="Anexar arquivo"
                  onClick={() =>
                    toast.mostrar(
                      "info",
                      "Envio de anexos exige armazenamento configurado. Configure em Configurações › Integração do WhatsApp.",
                    )
                  }
                >
                  <Paperclip className="size-5" aria-hidden />
                </BotaoIcone>
                {organizacao.aiEnabled && (
                  <BotaoIcone
                    rotulo="Sugerir resposta com IA"
                    onClick={sugerirResposta}
                    carregando={sugerindo}
                  >
                    <Sparkles className="size-5" aria-hidden />
                  </BotaoIcone>
                )}
              </div>

              <label htmlFor="campo-mensagem" className="apenas-leitor-tela">
                Mensagem para o cliente
              </label>
              <textarea
                id="campo-mensagem"
                ref={campoTexto}
                rows={1}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  const alvo = e.target;
                  alvo.style.height = "auto";
                  alvo.style.height = `${Math.min(alvo.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                placeholder="Escreva sua mensagem…  (Enter envia, Shift+Enter quebra linha)"
                className="max-h-40 min-h-11 flex-1 resize-none rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-3 py-2.5 text-sm placeholder:text-[var(--texto-3)] focus:border-[var(--primaria)]"
              />

              <Botao
                onClick={() => void enviar()}
                carregando={enviando}
                disabled={!texto.trim()}
                aria-label="Enviar mensagem"
                className="size-11 shrink-0 p-0"
              >
                {!enviando && <Send className="size-4.5" aria-hidden />}
              </Botao>
            </div>
          </>
        )}
      </div>

      <ModalTransferencia
        aberto={modalTransferencia}
        conversaId={conversaId}
        aoFechar={() => setModalTransferencia(false)}
        aoConcluir={() => {
          setModalTransferencia(false);
          void carregar();
          aoMudar?.();
        }}
      />
      <ModalEncerramento
        aberto={modalEncerramento}
        conversaId={conversaId}
        aoFechar={() => setModalEncerramento(false)}
        aoConcluir={() => {
          setModalEncerramento(false);
          void carregar();
          aoMudar?.();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Subcomponentes
 * ------------------------------------------------------------------ */

function BalaoMensagem({
  mensagem,
  aoReenviar,
}: {
  mensagem: Mensagem;
  aoReenviar: (id: string) => void;
}) {
  const doCliente = mensagem.direction === "inbound";
  const doSistema = mensagem.senderType === "system";

  if (doSistema) {
    return (
      <div className="my-1 flex justify-center">
        <p className="max-w-md rounded-lg bg-[var(--superficie-2)] px-3 py-1.5 text-center text-xs text-[var(--texto-2)]">
          <Info className="mr-1 inline size-3" aria-hidden />
          {mensagem.content}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex", doCliente ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 sm:max-w-[70%]",
          doCliente
            ? "rounded-tl-sm bg-[var(--superficie)] border border-[var(--borda)]"
            : "rounded-tr-sm bg-[var(--primaria)] text-white",
          mensagem.status === "failed" && "border border-[var(--color-erro)]",
        )}
      >
        {!doCliente && mensagem.senderName && (
          <p className="mb-0.5 text-xs font-medium opacity-80">
            {mensagem.senderName}
            {mensagem.aiSuggested && " · sugerida por IA"}
          </p>
        )}

        {mensagem.mediaUrl && (
          <p className="mb-1 text-xs opacity-90">
            <Paperclip className="mr-1 inline size-3" aria-hidden />
            {mensagem.mediaFileName ?? rotuloMidia(mensagem.messageType)}
          </p>
        )}

        <p className="text-sm break-words whitespace-pre-wrap">
          {mensagem.content ?? rotuloMidia(mensagem.messageType)}
        </p>

        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[11px]",
            doCliente ? "text-[var(--texto-3)]" : "text-white/80",
          )}
        >
          <time dateTime={mensagem.createdAt}>
            {formatarHora(mensagem.createdAt)}
          </time>
          {!doCliente && <IconeStatus status={mensagem.status} />}
        </div>

        {mensagem.status === "failed" && (
          <div className="mt-1.5 border-t border-white/25 pt-1.5">
            <p className="text-[11px]">
              {mensagem.failureReason ?? "Falha no envio."}
            </p>
            <button
              type="button"
              onClick={() => aoReenviar(mensagem.id)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold underline"
            >
              <RefreshCw className="size-3" aria-hidden />
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IconeStatus({ status }: { status: string }) {
  const rotulo = ROTULOS_ENVIO[status] ?? status;
  if (status === "queued") {
    return <Clock className="size-3" aria-label={rotulo} />;
  }
  if (status === "sent") return <Check className="size-3" aria-label={rotulo} />;
  if (status === "delivered") {
    return <CheckCheck className="size-3" aria-label={rotulo} />;
  }
  if (status === "read") {
    return <CheckCheck className="size-3 text-white" aria-label={rotulo} />;
  }
  if (status === "failed") {
    return <AlertCircle className="size-3" aria-label={rotulo} />;
  }
  return null;
}

function BotaoIcone({
  children,
  rotulo,
  onClick,
  ativo,
  carregando,
}: {
  children: React.ReactNode;
  rotulo: string;
  onClick: () => void;
  ativo?: boolean;
  carregando?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      disabled={carregando}
      className={cn(
        "flex size-11 items-center justify-center rounded-lg transition-colors",
        ativo
          ? "bg-[var(--primaria)]/12 text-[var(--primaria)]"
          : "text-[var(--texto-2)] hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]",
      )}
    >
      {carregando ? <Loader2 className="size-5 animate-spin" aria-hidden /> : children}
    </button>
  );
}

function EsqueletoConversa() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-[var(--borda)] p-4">
        <Esqueleto className="h-4 w-40" />
        <Esqueleto className="h-3 w-56" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Esqueleto className="h-14 w-2/3" />
        <Esqueleto className="ml-auto h-14 w-1/2" />
        <Esqueleto className="h-14 w-3/5" />
      </div>
    </div>
  );
}

/* ------------------------------ Auxiliares ------------------------------ */

function agruparPorData(mensagens: Mensagem[]): [string, Mensagem[]][] {
  const mapa = new Map<string, Mensagem[]>();
  for (const mensagem of mensagens) {
    const rotulo = rotuloDia(mensagem.createdAt);
    const lista = mapa.get(rotulo) ?? [];
    lista.push(mensagem);
    mapa.set(rotulo, lista);
  }
  return [...mapa.entries()];
}

function rotuloDia(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);

  const mesmoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (mesmoDia(data, hoje)) return "Hoje";
  if (mesmoDia(data, ontem)) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

function rotuloMidia(tipo: string): string {
  const rotulos: Record<string, string> = {
    image: "Imagem",
    audio: "Áudio",
    video: "Vídeo",
    document: "Documento",
    location: "Localização",
    template: "Mensagem de modelo",
  };
  return rotulos[tipo] ?? "Mensagem";
}

function corStatus(status: string): string {
  const cores: Record<string, string> = {
    unassigned: "#64748B",
    waiting: "#F59E0B",
    in_progress: "#16A34A",
    waiting_customer: "#2563EB",
    scheduled: "#7C3AED",
    closed: "#94A3B8",
  };
  return cores[status] ?? "#64748B";
}

export { formatarDataHora };
