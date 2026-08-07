import Link from "next/link";
import { CloudOff } from "lucide-react";
import { Logotipo } from "@/components/logotipo";

export const metadata = { title: "Sem conexão" };

export default function PaginaOffline() {
  return (
    <main
      id="conteudo-principal"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center"
    >
      <Logotipo tamanho="grande" />
      <CloudOff className="size-10 text-[var(--texto-3)]" aria-hidden />
      <h1 className="text-xl font-semibold">Você está offline</h1>
      <p className="max-w-sm text-sm text-[var(--texto-2)]">
        As atualizações serão retomadas assim que a conexão voltar. Nenhuma
        mensagem digitada é perdida.
      </p>
      <Link
        href="/atendimentos"
        className="inline-flex min-h-11 items-center rounded-lg bg-[var(--primaria)] px-5 text-sm font-semibold text-white"
      >
        Tentar novamente
      </Link>
    </main>
  );
}
