import type { Metadata } from "next";
import { CabecalhoApp } from "@/components/app/navegacao";
import { TelaContatos } from "./tela-contatos";

export const metadata: Metadata = { title: "Contatos" };

export default function PaginaContatos() {
  return (
    <>
      <CabecalhoApp titulo="Contatos" />
      <TelaContatos />
    </>
  );
}
