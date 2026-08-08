"use client";

/**
 * Navegação do aplicativo.
 * Desktop: barra lateral fixa. Mobile: barra inferior com alvos de toque
 * grandes, conforme o padrão de aplicativo instalável.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Inbox,
  BookUser,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn, ROTULOS_PERFIL } from "@/lib/utils";
import { Avatar, Botao } from "@/components/ui";
import { Logotipo } from "@/components/logotipo";
import { useSessao } from "./sessao";
import { SinoNotificacoes } from "./notificacoes";
import { IndicadorConexao } from "./indicador-conexao";
import type { Permission } from "@/lib/auth/rbac";

type ItemNavegacao = {
  href: string;
  rotulo: string;
  Icone: typeof Inbox;
  permissao?: Permission;
  /** Aparece na barra inferior do mobile. */
  mobile?: boolean;
};

const ITENS: ItemNavegacao[] = [
  { href: "/painel", rotulo: "Painel", Icone: LayoutDashboard, mobile: true },
  { href: "/atendimentos", rotulo: "Atendimentos", Icone: Inbox, mobile: true },
  { href: "/contatos", rotulo: "Contatos", Icone: BookUser, mobile: true },
  { href: "/kanban", rotulo: "Kanban", Icone: KanbanSquare, mobile: true },
  { href: "/agenda", rotulo: "Agenda", Icone: CalendarDays, mobile: true },
  {
    href: "/equipe",
    rotulo: "Equipe",
    Icone: Users,
    permissao: "users.view",
  },
  { href: "/relatorios", rotulo: "Relatórios", Icone: BarChart3 },
  {
    href: "/configuracoes",
    rotulo: "Configurações",
    Icone: Settings,
    mobile: true,
  },
];

export function BarraLateral() {
  const caminho = usePathname();
  const { usuario, organizacao, pode } = useSessao();
  const itens = ITENS.filter((item) => !item.permissao || pode(item.permissao));

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--borda)] bg-[var(--superficie)] lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/painel" aria-label="Ir para o painel">
          <Logotipo />
        </Link>
      </div>

      {organizacao.demoMode && <SeloDemonstracao className="mx-4 mb-3" />}

      <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Menu principal">
        {itens.map(({ href, rotulo, Icone }) => {
          const ativo = caminho === href || caminho.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                ativo
                  ? "bg-[var(--primaria)]/12 text-[var(--primaria)]"
                  : "text-[var(--texto-2)] hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]",
              )}
            >
              <Icone className="size-4.5 shrink-0" aria-hidden />
              {rotulo}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--borda)] p-3">
        <div className="mb-2 flex items-center gap-2.5 px-2">
          <Avatar nome={usuario.name} url={usuario.avatarUrl} tamanho={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{usuario.name}</p>
            <p className="truncate text-xs text-[var(--texto-2)]">
              {ROTULOS_PERFIL[usuario.role]}
            </p>
          </div>
        </div>
        <BotaoSair />
      </div>
    </aside>
  );
}

export function CabecalhoApp({ titulo }: { titulo?: string }) {
  const { organizacao } = useSessao();
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--borda)] bg-[var(--superficie)] px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/painel" className="lg:hidden" aria-label="Ir para o painel">
          <Logotipo somenteSimbolo />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {titulo ?? organizacao.inboxName}
          </h1>
          <p className="truncate text-xs text-[var(--texto-2)]">
            {organizacao.name}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <IndicadorConexao />
        <SinoNotificacoes />
      </div>
    </header>
  );
}

export function BarraInferior() {
  const caminho = usePathname();
  const { pode } = useSessao();
  const itens = ITENS.filter(
    (item) => item.mobile && (!item.permissao || pode(item.permissao)),
  );

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-[var(--borda)] bg-[var(--superficie)] pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Navegação principal"
    >
      {itens.map(({ href, rotulo, Icone }) => {
        const ativo = caminho === href || caminho.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors",
              ativo ? "text-[var(--primaria)]" : "text-[var(--texto-2)]",
            )}
          >
            <Icone className="size-5" aria-hidden />
            <span className="truncate">{rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SeloDemonstracao({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "rounded-lg border border-[var(--color-alerta)]/40 bg-[var(--color-alerta)]/10 px-3 py-1.5 text-center text-xs font-semibold text-[var(--color-alerta)]",
        className,
      )}
    >
      Modo demonstração
    </p>
  );
}

function BotaoSair() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  return (
    <Botao
      variante="sutil"
      tamanho="pequeno"
      carregando={saindo}
      iconeEsquerda={<LogOut className="size-4" aria-hidden />}
      className="w-full justify-start"
      onClick={async () => {
        setSaindo(true);
        try {
          await api("/api/auth/logout", { method: "POST" });
        } finally {
          router.push("/entrar");
          router.refresh();
        }
      }}
    >
      Sair
    </Botao>
  );
}
