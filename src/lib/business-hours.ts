/**
 * Horário de funcionamento — da empresa e por usuário.
 * Todos os cálculos respeitam o fuso configurado (padrão America/Sao_Paulo).
 */
import type { BusinessHours } from "@/db/schema";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  sun: "Domingo",
  mon: "Segunda-feira",
  tue: "Terça-feira",
  wed: "Quarta-feira",
  thu: "Quinta-feira",
  fri: "Sexta-feira",
  sat: "Sábado",
};

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: [{ start: "08:00", end: "18:00" }],
  tue: [{ start: "08:00", end: "18:00" }],
  wed: [{ start: "08:00", end: "18:00" }],
  thu: [{ start: "08:00", end: "18:00" }],
  fri: [{ start: "08:00", end: "18:00" }],
  sat: [{ start: "08:00", end: "12:00" }],
};

/** Retorna { day, minutes } do instante `date` no fuso informado. */
export function zonedDayAndMinutes(
  date: Date,
  timezone: string,
): { day: DayKey; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  const map: Record<string, DayKey> = {
    Sun: "sun",
    Mon: "mon",
    Tue: "tue",
    Wed: "wed",
    Thu: "thu",
    Fri: "fri",
    Sat: "sat",
  };
  return { day: map[weekday] ?? "mon", minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number.parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function isWithinBusinessHours(
  hours: BusinessHours | null | undefined,
  timezone: string,
  at: Date = new Date(),
): boolean {
  // Sem configuração = atendimento 24/7 (não bloqueia nada por engano).
  if (!hours || Object.keys(hours).length === 0) return true;

  const { day, minutes } = zonedDayAndMinutes(at, timezone);
  const ranges = hours[day];
  if (!ranges || ranges.length === 0) return false;

  return ranges.some((range) => {
    const start = toMinutes(range.start);
    const end = toMinutes(range.end);
    // Faixa que atravessa a meia-noite (ex.: 22:00 → 02:00).
    if (end <= start) return minutes >= start || minutes < end;
    return minutes >= start && minutes < end;
  });
}

/** Texto curto para exibir nas telas e nas variáveis de resposta rápida. */
export function describeBusinessHours(
  hours: BusinessHours | null | undefined,
): string {
  if (!hours || Object.keys(hours).length === 0) return "Atendimento 24 horas";
  const parts: string[] = [];
  for (const day of DAY_KEYS) {
    const ranges = hours[day];
    if (!ranges || ranges.length === 0) continue;
    const label = DAY_LABELS[day].replace("-feira", "");
    parts.push(
      `${label}: ${ranges.map((r) => `${r.start} às ${r.end}`).join(", ")}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "Fechado";
}

export { DAY_KEYS };
