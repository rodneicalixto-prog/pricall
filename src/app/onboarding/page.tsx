import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getOrganization } from "@/server/services/organization";
import { AssistenteOnboarding } from "./assistente";

export const metadata: Metadata = { title: "Configuração inicial" };

export default async function PaginaOnboarding() {
  const auth = await getAuthContext();
  if (!auth) redirect("/entrar");
  if (auth.role !== "admin") redirect("/atendimentos");

  const organizacao = await getOrganization(auth.organizationId);
  if (organizacao.onboardingCompletedAt) redirect("/painel");

  return (
    <AssistenteOnboarding
      nomeInicial={organizacao.name}
      segmentoInicial={organizacao.segment ?? ""}
    />
  );
}
