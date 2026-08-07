"use client";

/**
 * Componentes base acessíveis do PRICALL.
 * Todos têm foco visível, rótulo associado e área de toque adequada (44 px).
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import {
  cn,
  iniciais,
  ROTULOS_PRIORIDADE,
  ROTULOS_STATUS,
} from "@/lib/utils";

/* ------------------------------- Botão ------------------------------- */

type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "secundario" | "sutil" | "perigo" | "contorno";
  tamanho?: "pequeno" | "medio" | "grande";
  carregando?: boolean;
  iconeEsquerda?: ReactNode;
};

export function Botao({
  variante = "primario",
  tamanho = "medio",
  carregando = false,
  iconeEsquerda,
  className,
  children,
  disabled,
  ...props
}: BotaoProps) {
  const variantes = {
    primario:
      "bg-[var(--primaria)] text-white hover:brightness-110 active:brightness-95 shadow-sm",
    secundario:
      "bg-[var(--superficie-2)] text-[var(--texto)] hover:bg-[var(--borda)]",
    sutil: "bg-transparent text-[var(--texto-2)] hover:bg-[var(--superficie-2)]",
    perigo: "bg-[var(--color-erro)] text-white hover:brightness-110",
    contorno:
      "bg-transparent border border-[var(--borda)] text-[var(--texto)] hover:bg-[var(--superficie-2)]",
  };
  const tamanhos = {
    pequeno: "h-9 px-3 text-sm gap-1.5",
    medio: "min-h-11 px-4 text-sm gap-2",
    grande: "min-h-12 px-6 text-base gap-2",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-55",
        variantes[variante],
        tamanhos[tamanho],
        className,
      )}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...props}
    >
      {carregando ? (
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
      ) : (
        iconeEsquerda
      )}
      {children}
    </button>
  );
}

/* ------------------------------- Campos ------------------------------- */

type CampoBase = {
  rotulo: string;
  erro?: string;
  dica?: string;
  obrigatorio?: boolean;
};

export function Campo({
  rotulo,
  erro,
  dica,
  obrigatorio,
  className,
  id,
  ...props
}: CampoBase & InputHTMLAttributes<HTMLInputElement>) {
  const geradoId = useId();
  const campoId = id ?? geradoId;
  const erroId = `${campoId}-erro`;
  const dicaId = `${campoId}-dica`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={campoId} className="text-sm font-medium">
        {rotulo}
        {obrigatorio && (
          <span className="ml-0.5 text-[var(--color-erro)]" aria-hidden>
            *
          </span>
        )}
      </label>
      <input
        id={campoId}
        aria-invalid={erro ? true : undefined}
        aria-describedby={cn(erro && erroId, dica && dicaId) || undefined}
        aria-required={obrigatorio}
        className={cn(
          "min-h-11 rounded-lg border bg-[var(--superficie)] px-3 text-sm transition-colors",
          "border-[var(--borda)] placeholder:text-[var(--texto-3)]",
          "focus:border-[var(--primaria)]",
          erro && "border-[var(--color-erro)]",
          className,
        )}
        {...props}
      />
      {dica && !erro && (
        <p id={dicaId} className="text-xs text-[var(--texto-2)]">
          {dica}
        </p>
      )}
      {erro && (
        <p id={erroId} role="alert" className="text-xs text-[var(--color-erro)]">
          {erro}
        </p>
      )}
    </div>
  );
}

export function AreaTexto({
  rotulo,
  erro,
  dica,
  obrigatorio,
  className,
  id,
  ...props
}: CampoBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const geradoId = useId();
  const campoId = id ?? geradoId;
  const erroId = `${campoId}-erro`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={campoId} className="text-sm font-medium">
        {rotulo}
        {obrigatorio && (
          <span className="ml-0.5 text-[var(--color-erro)]" aria-hidden>
            *
          </span>
        )}
      </label>
      <textarea
        id={campoId}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? erroId : undefined}
        className={cn(
          "min-h-24 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] p-3 text-sm",
          "placeholder:text-[var(--texto-3)] focus:border-[var(--primaria)]",
          erro && "border-[var(--color-erro)]",
          className,
        )}
        {...props}
      />
      {dica && !erro && <p className="text-xs text-[var(--texto-2)]">{dica}</p>}
      {erro && (
        <p id={erroId} role="alert" className="text-xs text-[var(--color-erro)]">
          {erro}
        </p>
      )}
    </div>
  );
}

export function Selecao({
  rotulo,
  erro,
  dica,
  obrigatorio,
  className,
  id,
  children,
  ...props
}: CampoBase & SelectHTMLAttributes<HTMLSelectElement>) {
  const geradoId = useId();
  const campoId = id ?? geradoId;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={campoId} className="text-sm font-medium">
        {rotulo}
        {obrigatorio && (
          <span className="ml-0.5 text-[var(--color-erro)]" aria-hidden>
            *
          </span>
        )}
      </label>
      <select
        id={campoId}
        aria-invalid={erro ? true : undefined}
        className={cn(
          "min-h-11 rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-3 text-sm",
          "focus:border-[var(--primaria)]",
          erro && "border-[var(--color-erro)]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {dica && !erro && <p className="text-xs text-[var(--texto-2)]">{dica}</p>}
      {erro && (
        <p role="alert" className="text-xs text-[var(--color-erro)]">
          {erro}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ Etiquetas ------------------------------ */

export function Etiqueta({
  children,
  cor,
  className,
}: {
  children: ReactNode;
  cor?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={
        cor
          ? { backgroundColor: `${cor}1f`, color: cor, border: `1px solid ${cor}40` }
          : undefined
      }
    >
      {children}
    </span>
  );
}

const CORES_STATUS: Record<string, string> = {
  unassigned: "#64748B",
  waiting: "#F59E0B",
  in_progress: "#16A34A",
  waiting_customer: "#2563EB",
  scheduled: "#7C3AED",
  closed: "#94A3B8",
};

const CORES_PRIORIDADE: Record<string, string> = {
  low: "#94A3B8",
  normal: "#64748B",
  high: "#F59E0B",
  urgent: "#DC2626",
};

export function EtiquetaStatus({ status }: { status: string }) {
  return (
    <Etiqueta cor={CORES_STATUS[status] ?? "#64748B"}>
      {ROTULOS_STATUS[status] ?? status}
    </Etiqueta>
  );
}

export function EtiquetaPrioridade({ prioridade }: { prioridade: string }) {
  if (prioridade === "normal" || prioridade === "low") return null;
  return (
    <Etiqueta cor={CORES_PRIORIDADE[prioridade]}>
      {ROTULOS_PRIORIDADE[prioridade]}
    </Etiqueta>
  );
}

/* -------------------------------- Cartão -------------------------------- */

export function Cartao({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--borda)] bg-[var(--superficie)] p-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* -------------------------------- Estados -------------------------------- */

export function Esqueleto({ className }: { className?: string }) {
  return <div className={cn("esqueleto h-4 w-full", className)} aria-hidden />;
}

export function EstadoVazio({
  titulo,
  descricao,
  icone,
  acao,
}: {
  titulo: string;
  descricao?: string;
  icone?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icone && <div className="text-[var(--texto-3)]">{icone}</div>}
      <p className="text-sm font-medium">{titulo}</p>
      {descricao && (
        <p className="max-w-sm text-sm text-[var(--texto-2)]">{descricao}</p>
      )}
      {acao}
    </div>
  );
}

export function EstadoErro({
  mensagem,
  aoTentarNovamente,
}: {
  mensagem: string;
  aoTentarNovamente?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 px-6 py-12 text-center"
    >
      <AlertCircle className="size-8 text-[var(--color-erro)]" aria-hidden />
      <p className="text-sm">{mensagem}</p>
      {aoTentarNovamente && (
        <Botao variante="contorno" tamanho="pequeno" onClick={aoTentarNovamente}>
          Tentar novamente
        </Botao>
      )}
    </div>
  );
}

export function Aviso({
  tipo = "info",
  children,
}: {
  tipo?: "info" | "sucesso" | "alerta" | "erro";
  children: ReactNode;
}) {
  const estilos = {
    info: { cor: "#2563EB", Icone: Info },
    sucesso: { cor: "#16A34A", Icone: CheckCircle2 },
    alerta: { cor: "#F59E0B", Icone: AlertCircle },
    erro: { cor: "#DC2626", Icone: AlertCircle },
  } as const;
  const { cor, Icone } = estilos[tipo];

  return (
    <div
      role={tipo === "erro" ? "alert" : "status"}
      className="flex items-start gap-2.5 rounded-lg border p-3 text-sm"
      style={{ borderColor: `${cor}40`, backgroundColor: `${cor}12`, color: cor }}
    >
      <Icone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-[var(--texto)]">{children}</div>
    </div>
  );
}

/* -------------------------------- Modal -------------------------------- */

export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  rodape,
  largura = "media",
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: "estreita" | "media" | "larga";
}) {
  const referencia = useRef<HTMLDivElement>(null);
  const tituloId = useId();

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    // Move o foco para dentro do diálogo ao abrir.
    referencia.current?.focus();
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  const larguras = {
    estreita: "max-w-md",
    media: "max-w-xl",
    larga: "max-w-3xl",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) aoFechar();
      }}
    >
      <div
        ref={referencia}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={cn(
          "flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--borda)] bg-[var(--superficie)] sm:rounded-2xl",
          larguras[largura],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--borda)] p-4">
          <div>
            <h2 id={tituloId} className="text-base font-semibold">
              {titulo}
            </h2>
            {descricao && (
              <p className="mt-0.5 text-sm text-[var(--texto-2)]">{descricao}</p>
            )}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded-lg p-2 text-[var(--texto-2)] hover:bg-[var(--superficie-2)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {rodape && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--borda)] p-4">
            {rodape}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Avatar ------------------------------- */

export function Avatar({
  nome,
  url,
  tamanho = 40,
  disponibilidade,
}: {
  nome: string;
  url?: string | null;
  tamanho?: number;
  disponibilidade?: "online" | "away" | "offline";
}) {
  const cores: Record<string, string> = {
    online: "#16A34A",
    away: "#F59E0B",
    offline: "#94A3B8",
  };

  return (
    <div className="relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="size-full rounded-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center rounded-full bg-[var(--superficie-2)] font-medium text-[var(--texto-2)]"
          style={{ fontSize: tamanho * 0.36 }}
          aria-hidden
        >
          {iniciais(nome)}
        </div>
      )}
      {disponibilidade && (
        <span
          className="absolute right-0 bottom-0 rounded-full border-2 border-[var(--superficie)]"
          style={{
            width: tamanho * 0.3,
            height: tamanho * 0.3,
            backgroundColor: cores[disponibilidade],
          }}
          title={disponibilidade}
        />
      )}
    </div>
  );
}

/* --------------------------- Notificações toast --------------------------- */

type Toast = { id: number; tipo: "sucesso" | "erro" | "info"; texto: string };
type ToastContexto = { mostrar: (tipo: Toast["tipo"], texto: string) => void };

const Contexto = createContext<ToastContexto>({ mostrar: () => {} });

export function useToast() {
  return useContext(Contexto);
}

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const mostrar = (tipo: Toast["tipo"], texto: string) => {
    const id = Date.now() + Math.random();
    setToasts((atual) => [...atual, { id, tipo, texto }]);
    setTimeout(() => {
      setToasts((atual) => atual.filter((t) => t.id !== id));
    }, 5000);
  };

  return (
    <Contexto.Provider value={{ mostrar }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:top-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tipo === "erro" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg",
              "bg-[var(--superficie)] border-[var(--borda)]",
            )}
          >
            {toast.tipo === "sucesso" && (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--color-brand-500)]" aria-hidden />
            )}
            {toast.tipo === "erro" && (
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-erro)]" aria-hidden />
            )}
            {toast.tipo === "info" && (
              <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-informacao)]" aria-hidden />
            )}
            <span className="flex-1">{toast.texto}</span>
            <button
              type="button"
              aria-label="Dispensar aviso"
              onClick={() => setToasts((a) => a.filter((t) => t.id !== toast.id))}
              className="rounded p-0.5 text-[var(--texto-3)] hover:text-[var(--texto)]"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}
