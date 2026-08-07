"use client";

import { useState } from "react";
import { api, mensagemDeErro } from "@/lib/api-client";
import { Aviso, Botao, Campo } from "@/components/ui";

export function FormularioRecuperacao() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"parado" | "enviando" | "enviado">("parado");
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEstado("enviando");
    try {
      await api("/api/auth/forgot-password", { method: "POST", json: { email } });
      setEstado("enviado");
    } catch (error) {
      setErro(mensagemDeErro(error));
      setEstado("parado");
    }
  }

  if (estado === "enviado") {
    return (
      <Aviso tipo="sucesso">
        Se este e-mail estiver cadastrado, enviaremos as instruções de
        recuperação em instantes. Verifique também a caixa de spam.
      </Aviso>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo
        rotulo="E-mail"
        type="email"
        inputMode="email"
        autoComplete="email"
        obrigatorio
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Botao type="submit" carregando={estado === "enviando"} className="w-full">
        Enviar instruções
      </Botao>
    </form>
  );
}
