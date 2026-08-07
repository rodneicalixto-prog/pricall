/**
 * Substituição de variáveis nas respostas rápidas.
 * Variáveis desconhecidas ficam visíveis para o vendedor perceber o erro
 * antes de enviar (a pré-visualização usa esta mesma função).
 */

export type TemplateVariables = {
  nome_cliente?: string;
  nome_vendedor?: string;
  nome_empresa?: string;
  horario_atendimento?: string;
  primeiro_nome_cliente?: string;
  telefone_cliente?: string;
  data_hoje?: string;
  [key: string]: string | undefined;
};

export const SUPPORTED_VARIABLES = [
  "nome_cliente",
  "primeiro_nome_cliente",
  "nome_vendedor",
  "nome_empresa",
  "horario_atendimento",
  "telefone_cliente",
  "data_hoje",
] as const;

const PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(
  template: string,
  variables: TemplateVariables,
): string {
  return template.replace(PATTERN, (match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null || value === "") return match;
    return value;
  });
}

/** Variáveis presentes no texto que não têm valor disponível. */
export function missingVariables(
  template: string,
  variables: TemplateVariables,
): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PATTERN)) {
    const key = match[1];
    const value = variables[key];
    if (value === undefined || value === null || value === "") found.add(key);
  }
  return [...found];
}

/** Primeiro nome, útil para saudações. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function buildVariables(input: {
  contactName?: string | null;
  contactPhone?: string | null;
  sellerName?: string | null;
  organizationName?: string | null;
  businessHours?: string | null;
  timezone?: string;
}): TemplateVariables {
  const contactName = input.contactName ?? undefined;
  return {
    nome_cliente: contactName,
    primeiro_nome_cliente: contactName ? firstName(contactName) : undefined,
    nome_vendedor: input.sellerName ?? undefined,
    nome_empresa: input.organizationName ?? undefined,
    horario_atendimento: input.businessHours ?? undefined,
    telefone_cliente: input.contactPhone ?? undefined,
    data_hoje: new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "long",
      timeZone: input.timezone ?? "America/Sao_Paulo",
    }).format(new Date()),
  };
}
