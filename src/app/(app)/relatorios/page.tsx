import type { Metadata } from "next";
import { CabecalhoApp } from "@/components/app/navegacao";
import { TelaRelatorios } from "./tela-relatorios";

export const metadata: Metadata = { title: "Relatórios" };

export default function PaginaRelatorios() {
  return (
    <>
      <CabecalhoApp titulo="Relatórios" />
      <TelaRelatorios />
    </>
  );
}
