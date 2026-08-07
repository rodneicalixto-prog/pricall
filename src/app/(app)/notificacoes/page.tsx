import type { Metadata } from "next";
import { CabecalhoApp } from "@/components/app/navegacao";
import { TelaNotificacoes } from "./tela-notificacoes";

export const metadata: Metadata = { title: "Notificações" };

export default function PaginaNotificacoes() {
  return (
    <>
      <CabecalhoApp titulo="Notificações" />
      <TelaNotificacoes />
    </>
  );
}
