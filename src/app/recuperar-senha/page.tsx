import type { Metadata } from "next";
import Link from "next/link";
import { Logotipo } from "@/components/logotipo";
import { FormularioRecuperacao } from "./formulario";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function PaginaRecuperarSenha() {
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
          <h1 className="text-xl font-semibold">Recuperar senha</h1>
          <p className="mt-1 mb-6 text-sm text-[var(--texto-2)]">
            Informe o e-mail cadastrado e enviaremos as instruções.
          </p>
          <FormularioRecuperacao />
        </div>
        <p className="mt-6 text-center text-sm">
          <Link href="/entrar" className="font-medium text-[var(--primaria)]">
            Voltar para o acesso
          </Link>
        </p>
      </div>
    </main>
  );
}
