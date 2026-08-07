"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, mensagemDeErro } from "@/lib/api-client";
import { Aviso, Botao, Campo } from "@/components/ui";

export function FormularioRedefinicao({ token }: { token: string }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!token) {
    return (
      <Aviso tipo="erro">
        Link de recuperação inválido ou incompleto. Solicite um novo link na tela
        de recuperação de senha.
      </Aviso>
    );
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    if (senha !== confirmacao) {
      setErro("As senhas não conferem.");
      return;
    }
    setEnviando(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        json: { token, password: senha, passwordConfirmation: confirmacao },
      });
      router.push("/entrar");
    } catch (error) {
      setErro(mensagemDeErro(error));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo
        rotulo="Nova senha"
        type="password"
        autoComplete="new-password"
        obrigatorio
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
      />
      <Campo
        rotulo="Confirmar nova senha"
        type="password"
        autoComplete="new-password"
        obrigatorio
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
      />
      <Botao type="submit" carregando={enviando} className="w-full">
        Salvar nova senha
      </Botao>
    </form>
  );
}
