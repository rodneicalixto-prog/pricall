import type { Metadata } from "next";
import { CabecalhoApp } from "@/components/app/navegacao";
import { TelaConfiguracoes } from "./tela-configuracoes";

export const metadata: Metadata = { title: "Configurações" };

export default function PaginaConfiguracoes() {
  return (
    <>
      <CabecalhoApp titulo="Configurações" />
      <TelaConfiguracoes />
    </>
  );
}
