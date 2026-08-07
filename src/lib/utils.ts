import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TZ = "America/Sao_Paulo";

/** Formatos brasileiros usados em toda a interface. */
export const formatarData = (valor: string | Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: TZ }).format(
    typeof valor === "string" ? new Date(valor) : valor,
  );

export const formatarHora = (valor: string | Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(typeof valor === "string" ? new Date(valor) : valor);

export const formatarDataHora = (valor: string | Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: TZ,
  }).format(typeof valor === "string" ? new Date(valor) : valor);

/** "há 5 min", "há 2 h", "ontem" — para listas de conversa. */
export function tempoRelativo(valor: string | Date): string {
  const data = typeof valor === "string" ? new Date(valor) : valor;
  const segundos = Math.floor((Date.now() - data.getTime()) / 1000);

  if (segundos < 60) return "agora";
  if (segundos < 3600) return `${Math.floor(segundos / 60)} min`;
  if (segundos < 86_400) return `${Math.floor(segundos / 3600)} h`;
  if (segundos < 172_800) return "ontem";
  if (segundos < 604_800) return `${Math.floor(segundos / 86_400)} dias`;
  return formatarData(data);
}

/** Segundos -> "3 min 20 s" / "1 h 05 min". */
export function formatarDuracao(segundos: number | null | undefined): string {
  if (segundos == null) return "—";
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${String(minutos % 60).padStart(2, "0")} min`;
}

export function formatarMinutos(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto > 0 ? `${horas} h ${resto} min` : `${horas} h`;
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return `${partes[0]![0]}${partes.at(-1)![0]}`.toUpperCase();
}

export const ROTULOS_STATUS: Record<string, string> = {
  unassigned: "Não atribuído",
  waiting: "Aguardando",
  in_progress: "Em atendimento",
  waiting_customer: "Aguardando cliente",
  scheduled: "Agendado",
  closed: "Encerrado",
};

export const ROTULOS_PRIORIDADE: Record<string, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export const ROTULOS_PERFIL: Record<string, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  seller: "Vendedor",
};

export const ROTULOS_DISPONIBILIDADE: Record<string, string> = {
  online: "Online",
  away: "Ausente",
  offline: "Offline",
};

export const ROTULOS_ENVIO: Record<string, string> = {
  queued: "Na fila",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  received: "Recebida",
};
