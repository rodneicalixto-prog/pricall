import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { Logotipo } from "@/components/logotipo";
import { FormularioLogin } from "./formulario";

export const metadata: Metadata = { title: "Entrar" };

export default async function PaginaLogin() {
  const auth = await getAuthContext();
  if (auth) redirect(auth.role === "seller" ? "/atendimentos" : "/painel");

  return (
    <main
      id="conteudo-principal"
      className="flex min-h-dvh flex-col items-center justify-center px-5 py-10"
    >
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center">
          <Logotipo tamanho="grande" />
        </Link>
        <div className="rounded-xl border border-[var(--borda)] bg-[var(--superficie)] p-6">
          <h1 className="text-xl font-semibold">Entrar na central</h1>
          <p className="mt-1 mb-6 text-sm text-[var(--texto-2)]">
            Use o e-mail cadastrado pela sua empresa.
          </p>
          <FormularioLogin />
        </div>
        <p className="mt-6 text-center text-sm text-[var(--texto-2)]">
          Ainda não tem conta?{" "}
          <Link href="/criar-empresa" className="font-medium text-[var(--primaria)]">
            Criar minha empresa
          </Link>
        </p>
      </div>
    </main>
  );
}
