import type { Metadata } from "next";
import { CentralAtendimento } from "@/components/inbox/central";

export const metadata: Metadata = { title: "Atendimento" };

export default async function PaginaAtendimento({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CentralAtendimento conversaInicial={id} />;
}
