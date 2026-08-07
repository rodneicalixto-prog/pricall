import type { Metadata } from "next";
import { CabecalhoApp } from "@/components/app/navegacao";
import { TelaKanban } from "./tela-kanban";

export const metadata: Metadata = { title: "Kanban" };

export default function PaginaKanban() {
  return (
    <>
      <CabecalhoApp titulo="Meus quadros" />
      <TelaKanban />
    </>
  );
}
