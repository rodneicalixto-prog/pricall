import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Clock3,
  Inbox,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { Logotipo } from "@/components/logotipo";

const beneficios = [
  {
    Icone: Inbox,
    titulo: "Caixa de entrada compartilhada",
    texto:
      "Todas as mensagens do número da empresa em um só lugar, organizadas por status e prioridade.",
  },
  {
    Icone: Users,
    titulo: "Cada conversa com um responsável",
    texto:
      "Atribuição atômica: dois vendedores nunca assumem o mesmo cliente sem perceber.",
  },
  {
    Icone: Workflow,
    titulo: "Distribuição automática",
    texto:
      "Rodízio, menor carga, por setor ou primeiro disponível — você escolhe a regra.",
  },
  {
    Icone: Clock3,
    titulo: "Controle de tempo de espera",
    texto:
      "Alertas de conversa parada, tempo de primeira resposta e produtividade por vendedor.",
  },
  {
    Icone: BarChart3,
    titulo: "Relatórios que a diretoria entende",
    texto:
      "Atendimentos por vendedor, equipe e horário, motivos de encerramento e exportação em CSV.",
  },
  {
    Icone: ShieldCheck,
    titulo: "Histórico completo e auditoria",
    texto:
      "Toda transferência, encerramento e alteração fica registrada. Nada se perde.",
  },
];

export default function PaginaInicial() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
        <Logotipo />
        <nav className="flex items-center gap-2" aria-label="Acesso">
          <Link
            href="/entrar"
            className="min-h-11 rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--texto-2)] transition-colors hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]"
          >
            Entrar
          </Link>
          <Link
            href="/criar-empresa"
            className="inline-flex min-h-11 items-center rounded-lg bg-[var(--primaria)] px-4 py-2.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
          >
            Criar minha empresa
          </Link>
        </nav>
      </header>

      <main id="conteudo-principal">
        <section className="mx-auto max-w-6xl px-5 pt-10 pb-16 sm:pt-20">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--borda)] bg-[var(--superficie)] px-3 py-1 text-xs font-medium text-[var(--texto-2)]">
              Para equipes comerciais que atendem no WhatsApp
            </p>
            <h1 className="text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
              Organize seus atendimentos no WhatsApp
            </h1>
            <p className="mt-5 text-lg text-[var(--texto-2)]">
              O PRICALL centraliza as mensagens recebidas no número da sua
              empresa, distribui as conversas entre os vendedores, mostra quem
              está atendendo quem e registra todo o histórico do cliente.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/criar-empresa"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[var(--primaria)] px-6 text-base font-semibold text-white transition-[filter] hover:brightness-110"
              >
                Criar minha empresa
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/entrar"
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--borda)] bg-[var(--superficie)] px-6 text-base font-medium transition-colors hover:bg-[var(--superficie-2)]"
              >
                Entrar
              </Link>
            </div>
            <p className="mt-4 text-sm text-[var(--texto-2)]">
              Dá para testar tudo em <strong>modo demonstração</strong>, sem
              precisar conectar nenhum número.
            </p>
          </div>
        </section>

        <section
          className="border-y border-[var(--borda)] bg-[var(--superficie)]"
          aria-labelledby="beneficios"
        >
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 id="beneficios" className="text-2xl font-semibold">
              O que você resolve com o PRICALL
            </h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {beneficios.map(({ Icone, titulo, texto }) => (
                <div
                  key={titulo}
                  className="rounded-xl border border-[var(--borda)] bg-[var(--fundo)] p-5"
                >
                  <Icone
                    className="size-5 text-[var(--primaria)]"
                    aria-hidden
                  />
                  <h3 className="mt-3 font-semibold">{titulo}</h3>
                  <p className="mt-1.5 text-sm text-[var(--texto-2)]">{texto}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="rounded-xl border border-[var(--borda)] bg-[var(--superficie)] p-6">
            <h2 className="text-lg font-semibold">Integração oficial</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--texto-2)]">
              A conexão com o WhatsApp é feita pela plataforma oficial do
              WhatsApp Business (Cloud API), com opção de uso da Evolution API.
              O PRICALL é um produto independente: não utiliza o logotipo, a
              identidade visual nem a interface do WhatsApp, e não automatiza o
              WhatsApp Web.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--borda)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-[var(--texto-2)] sm:flex-row sm:items-center sm:justify-between">
          <Logotipo tamanho="pequeno" />
          <div className="flex flex-wrap gap-4">
            <Link href="/termos" className="hover:text-[var(--texto)]">
              Termos de uso
            </Link>
            <Link href="/privacidade" className="hover:text-[var(--texto)]">
              Política de privacidade
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
