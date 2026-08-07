"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, mensagemDeErro } from "@/lib/api-client";
import { Aviso, Botao, Campo } from "@/components/ui";

export function FormularioConvite({ token }: { token: string }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!token) {
    return <Aviso tipo="erro">Convite inválido ou incompleto.</Aviso>;
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api("/api/invite", {
        method: "POST",
        json: {
          token,
          password: senha,
          passwordConfirmation: confirmacao,
          phone: telefone || undefined,
        },
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
        rotulo="Senha"
        type="password"
        autoComplete="new-password"
        obrigatorio
        dica="Mínimo de 8 caracteres, com letras e números."
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
      />
      <Campo
        rotulo="Confirmar senha"
        type="password"
        autoComplete="new-password"
        obrigatorio
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
      />
      <Campo
        rotulo="Telefone (opcional)"
        type="tel"
        inputMode="tel"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
      />
      <Botao type="submit" carregando={enviando} className="w-full">
        Ativar minha conta
      </Botao>
    </form>
  );
}
