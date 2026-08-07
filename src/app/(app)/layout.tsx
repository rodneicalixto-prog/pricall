import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/rbac";
import { getOrganization } from "@/server/services/organization";
import { ProvedorSessao } from "@/components/app/sessao";
import { ProvedorTempoReal } from "@/components/app/tempo-real";
import { BarraInferior, BarraLateral } from "@/components/app/navegacao";
import { RegistroServiceWorker } from "@/components/app/service-worker";

export default async function LayoutApp({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthContext();
  if (!auth) redirect("/entrar");

  const organizacao = await getOrganization(auth.organizationId);

  // Empresa recém-criada vai direto para o onboarding.
  if (!organizacao.onboardingCompletedAt && auth.role === "admin") {
    redirect("/onboarding");
  }

  return (
    <ProvedorSessao
      usuario={{
        id: auth.userId,
        name: auth.name,
        email: auth.email,
        role: auth.role,
        avatarUrl: auth.avatarUrl,
        teamIds: auth.teamIds,
        supervisedTeamIds: auth.supervisedTeamIds,
      }}
      organizacao={{
        id: organizacao.id,
        name: organizacao.name,
        timezone: organizacao.timezone,
        primaryColor: organizacao.branding?.primaryColor ?? "#16A34A",
        inboxName: organizacao.branding?.inboxName ?? "Central de atendimento",
        demoMode: organizacao.settings?.demoMode ?? false,
        aiEnabled: organizacao.settings?.aiEnabled ?? true,
        maskPhoneForSellers: organizacao.settings?.maskPhoneForSellers ?? false,
      }}
      permissoes={permissionsOf(auth.role)}
    >
      <ProvedorTempoReal>
        <div className="flex h-dvh overflow-hidden">
          <BarraLateral />
          <div className="flex min-w-0 flex-1 flex-col">
            <main id="conteudo-principal" className="flex min-h-0 flex-1 flex-col">
              {children}
            </main>
            <BarraInferior />
          </div>
        </div>
        <RegistroServiceWorker />
      </ProvedorTempoReal>
    </ProvedorSessao>
  );
}
