import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { Logotipo } from "@/components/logotipo";
import { FormularioCadastro } from "./formulario";

export const metadata: Metadata = { title: "Criar minha empresa" };

export default async function PaginaCadastro() {
  const auth = await getAuthContext();
  if (auth) redirect("/painel");

  return (
    <main
      id="conteudo-principal"
      className="flex min-h-dvh flex-col items-center justify-center px-5 py-10"
    >
      <div className="w-full max-w-lg">
        <Link href="/" className="mb-8 flex justify-center">
          <Logotipo tamanho="grande" />
        </Link>
        <div className="rounded-xl border border-[var(--borda)] bg-[var(--superficie)] p-6">
          <h1 className="text-xl font-semibold">Criar minha empresa</h1>
          <p className="mt-1 mb-6 text-sm text-[var(--texto-2)]">
            Em poucos minutos sua central estará no ar. Você poderá testar tudo
            em modo demonstração antes de conectar um número real.
          </p>
          <FormularioCadastro />
        </div>
        <p className="mt-6 text-center text-sm text-[var(--texto-2)]">
          Já tem conta?{" "}
          <Link href="/entrar" className="font-medium text-[var(--primaria)]">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
