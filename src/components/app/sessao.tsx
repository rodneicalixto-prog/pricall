"use client";

/**
 * Contexto de sessão do cliente: usuário, organização, permissões e
 * preferências de exibição. Preenchido pelo layout do app com dados vindos
 * do servidor (sem round-trip adicional no primeiro carregamento).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Permission } from "@/lib/auth/rbac";

export type UsuarioSessao = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "supervisor" | "seller";
  avatarUrl: string | null;
  teamIds: string[];
  supervisedTeamIds: string[];
};

export type OrganizacaoSessao = {
  id: string;
  name: string;
  timezone: string;
  primaryColor: string;
  inboxName: string;
  demoMode: boolean;
  aiEnabled: boolean;
  maskPhoneForSellers: boolean;
};

export type Preferencias = {
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable";
  fontScale: number;
  reduceMotion: boolean;
  notificationSound: boolean;
};

type ValorSessao = {
  usuario: UsuarioSessao;
  organizacao: OrganizacaoSessao;
  permissoes: Permission[];
  pode: (permissao: Permission) => boolean;
  preferencias: Preferencias;
  definirPreferencias: (parcial: Partial<Preferencias>) => void;
};

const Contexto = createContext<ValorSessao | null>(null);

export function useSessao(): ValorSessao {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useSessao precisa estar dentro de ProvedorSessao.");
  return valor;
}

const PREFERENCIAS_PADRAO: Preferencias = {
  theme: "system",
  density: "comfortable",
  fontScale: 1,
  reduceMotion: false,
  notificationSound: true,
};

const CHAVE_ARMAZENAMENTO = "pricall:preferencias";

export function ProvedorSessao({
  usuario,
  organizacao,
  permissoes,
  preferenciasIniciais,
  children,
}: {
  usuario: UsuarioSessao;
  organizacao: OrganizacaoSessao;
  permissoes: Permission[];
  preferenciasIniciais?: Partial<Preferencias>;
  children: ReactNode;
}) {
  const [preferencias, setPreferencias] = useState<Preferencias>({
    ...PREFERENCIAS_PADRAO,
    ...preferenciasIniciais,
  });

  // Recupera ajustes locais (tema, densidade) feitos neste dispositivo.
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_ARMAZENAMENTO);
      if (salvo) setPreferencias((atual) => ({ ...atual, ...JSON.parse(salvo) }));
    } catch {
      /* armazenamento indisponível */
    }
  }, []);

  // Aplica tema, densidade, escala e movimento reduzido no documento.
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.remove("tema-claro", "tema-escuro");
    if (preferencias.theme === "light") raiz.classList.add("tema-claro");
    if (preferencias.theme === "dark") raiz.classList.add("tema-escuro");

    raiz.classList.toggle("movimento-reduzido", preferencias.reduceMotion);
    raiz.style.setProperty("--escala-fonte", String(preferencias.fontScale));
    raiz.style.setProperty("--primaria", organizacao.primaryColor);

    document.body.classList.remove("densidade-compacta", "densidade-confortavel");
    document.body.classList.add(
      preferencias.density === "compact"
        ? "densidade-compacta"
        : "densidade-confortavel",
    );
  }, [preferencias, organizacao.primaryColor]);

  const definirPreferencias = (parcial: Partial<Preferencias>) => {
    setPreferencias((atual) => {
      const proximo = { ...atual, ...parcial };
      try {
        localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(proximo));
      } catch {
        /* ignora */
      }
      return proximo;
    });
  };

  return (
    <Contexto.Provider
      value={{
        usuario,
        organizacao,
        permissoes,
        pode: (permissao) => permissoes.includes(permissao),
        preferencias,
        definirPreferencias,
      }}
    >
      {children}
    </Contexto.Provider>
  );
}
