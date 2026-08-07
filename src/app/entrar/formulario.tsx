"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, mensagemDeErro } from "@/lib/api-client";
import { Aviso, Botao, Campo } from "@/components/ui";

export function FormularioLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [manterConectado, setManterConectado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const resultado = await api<{ redirectTo: string }>("/api/auth/login", {
        method: "POST",
        json: { email, password: senha, remember: manterConectado },
      });
      router.push(resultado.redirectTo);
      router.refresh();
    } catch (error) {
      setErro(mensagemDeErro(error));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Campo
        rotulo="E-mail"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        obrigatorio
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="voce@empresa.com.br"
      />

      <Campo
        rotulo="Senha"
        type="password"
        name="password"
        autoComplete="current-password"
        obrigatorio
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
      />

      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={manterConectado}
            onChange={(e) => setManterConectado(e.target.checked)}
            className="size-4 rounded border-[var(--borda)] accent-[var(--primaria)]"
          />
          Manter conectado
        </label>
        <Link
          href="/recuperar-senha"
          className="text-sm font-medium text-[var(--primaria)]"
        >
          Recuperar senha
        </Link>
      </div>

      <Botao type="submit" carregando={enviando} className="mt-1 w-full">
        Acessar
      </Botao>
    </form>
  );
}
