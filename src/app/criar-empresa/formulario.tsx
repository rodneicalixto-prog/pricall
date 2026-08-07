"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api, mensagemDeErro } from "@/lib/api-client";
import { Aviso, Botao, Campo, Selecao } from "@/components/ui";

const SEGMENTOS = [
  "Loja / varejo",
  "Distribuidora",
  "Prestador de serviços",
  "Clínica / saúde",
  "Imobiliária",
  "Escola / curso",
  "Oficina",
  "Materiais de construção",
  "Alimentação",
  "Outro",
];

const FAIXAS_VENDEDORES = ["1 a 3", "4 a 10", "11 a 25", "26 a 50", "Mais de 50"];

export function FormularioCadastro() {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [errosCampo, setErrosCampo] = useState<Record<string, string>>({});
  const [dados, setDados] = useState({
    organizationName: "",
    responsibleName: "",
    email: "",
    phone: "",
    password: "",
    passwordConfirmation: "",
    segment: SEGMENTOS[0],
    sellerCount: FAIXAS_VENDEDORES[1],
    acceptedTerms: false,
  });

  const alterar = (campo: keyof typeof dados, valor: string | boolean) =>
    setDados((atual) => ({ ...atual, [campo]: valor }));

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setErrosCampo({});

    if (dados.password !== dados.passwordConfirmation) {
      setErrosCampo({ passwordConfirmation: "As senhas não conferem." });
      return;
    }
    if (!dados.acceptedTerms) {
      setErro("É necessário aceitar os termos de uso e a política de privacidade.");
      return;
    }

    setEnviando(true);
    try {
      const resultado = await api<{ redirectTo: string }>("/api/auth/register", {
        method: "POST",
        json: dados,
      });
      router.push(resultado.redirectTo);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.details)) {
        const mapa: Record<string, string> = {};
        for (const item of error.details as { campo: string; mensagem: string }[]) {
          mapa[item.campo] = item.mensagem;
        }
        setErrosCampo(mapa);
      }
      setErro(mensagemDeErro(error));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Campo
        rotulo="Nome da empresa"
        obrigatorio
        value={dados.organizationName}
        erro={errosCampo.organizationName}
        onChange={(e) => alterar("organizationName", e.target.value)}
      />
      <Campo
        rotulo="Nome do responsável"
        obrigatorio
        autoComplete="name"
        value={dados.responsibleName}
        erro={errosCampo.responsibleName}
        onChange={(e) => alterar("responsibleName", e.target.value)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="E-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          obrigatorio
          value={dados.email}
          erro={errosCampo.email}
          onChange={(e) => alterar("email", e.target.value)}
        />
        <Campo
          rotulo="Telefone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          obrigatorio
          placeholder="(11) 99999-9999"
          value={dados.phone}
          erro={errosCampo.phone}
          onChange={(e) => alterar("phone", e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="new-password"
          obrigatorio
          dica="Mínimo de 8 caracteres, com letras e números."
          value={dados.password}
          erro={errosCampo.password}
          onChange={(e) => alterar("password", e.target.value)}
        />
        <Campo
          rotulo="Confirmação de senha"
          type="password"
          autoComplete="new-password"
          obrigatorio
          value={dados.passwordConfirmation}
          erro={errosCampo.passwordConfirmation}
          onChange={(e) => alterar("passwordConfirmation", e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Selecao
          rotulo="Segmento da empresa"
          obrigatorio
          value={dados.segment}
          onChange={(e) => alterar("segment", e.target.value)}
        >
          {SEGMENTOS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Selecao>
        <Selecao
          rotulo="Número de vendedores"
          obrigatorio
          value={dados.sellerCount}
          onChange={(e) => alterar("sellerCount", e.target.value)}
        >
          {FAIXAS_VENDEDORES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Selecao>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={dados.acceptedTerms}
          onChange={(e) => alterar("acceptedTerms", e.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded border-[var(--borda)] accent-[var(--primaria)]"
        />
        <span className="text-[var(--texto-2)]">
          Li e aceito os{" "}
          <Link href="/termos" className="font-medium text-[var(--primaria)]" target="_blank">
            termos de uso
          </Link>{" "}
          e a{" "}
          <Link href="/privacidade" className="font-medium text-[var(--primaria)]" target="_blank">
            política de privacidade
          </Link>
          .
        </span>
      </label>

      <Botao type="submit" carregando={enviando} className="mt-1 w-full">
        Criar minha empresa
      </Botao>
    </form>
  );
}
