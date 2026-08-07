import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CabecalhoApp } from "@/components/app/navegacao";
import { TelaEquipe } from "./tela-equipe";

export const metadata: Metadata = { title: "Equipe" };

export default async function PaginaEquipe() {
  const auth = await getAuthContext();
  if (!auth) redirect("/entrar");
  if (!can(auth, "users.view")) redirect("/atendimentos");

  return (
    <>
      <CabecalhoApp titulo="Equipe" />
      <TelaEquipe podeGerenciar={can(auth, "users.manage")} />
    </>
  );
}
