import type { Metadata } from "next";
import { CabecalhoApp } from "@/components/app/navegacao";
import { TelaAgenda } from "./tela-agenda";

export const metadata: Metadata = { title: "Agenda" };

export default function PaginaAgenda() {
  return (
    <>
      <CabecalhoApp titulo="Agenda" />
      <TelaAgenda />
    </>
  );
}
