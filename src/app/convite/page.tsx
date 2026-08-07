import type { Metadata } from "next";
import Link from "next/link";
import { Logotipo } from "@/components/logotipo";
import { FormularioConvite } from "./formulario";

export const metadata: Metadata = { title: "Aceitar convite" };

export default async function PaginaConvite({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

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
          <h1 className="text-xl font-semibold">Aceitar convite</h1>
          <p className="mt-1 mb-6 text-sm text-[var(--texto-2)]">
            Defina sua senha para começar a atender.
          </p>
          <FormularioConvite token={token ?? ""} />
        </div>
      </div>
    </main>
  );
}
