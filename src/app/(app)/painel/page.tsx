import type { Metadata } from "next";
import { CabecalhoApp } from "@/components/app/navegacao";
import { PainelCliente } from "./painel-cliente";

export const metadata: Metadata = { title: "Painel" };

export default function PaginaPainel() {
  return (
    <>
      <CabecalhoApp titulo="Painel" />
      <PainelCliente />
    </>
  );
}
