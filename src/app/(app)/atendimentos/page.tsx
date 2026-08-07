import type { Metadata } from "next";
import { CentralAtendimento } from "@/components/inbox/central";

export const metadata: Metadata = { title: "Atendimentos" };

export default function PaginaAtendimentos() {
  return <CentralAtendimento />;
}
