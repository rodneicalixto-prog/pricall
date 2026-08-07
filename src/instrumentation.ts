/**
 * Executado uma vez no boot do servidor.
 * Falha cedo e com mensagem clara quando a configuração de produção está
 * incompleta — melhor um erro no deploy do que um comportamento estranho
 * descoberto em uso.
 */
import { assertProductionEnv, env } from "@/lib/env";

export async function register() {
  const problemas = assertProductionEnv();

  if (problemas.length > 0) {
    console.error(
      [
        "",
        "═══ PRICALL — configuração de produção incompleta ═══",
        ...problemas.map((p) => `  • ${p}`),
        "Consulte .env.example e docs/deploy-vercel.md.",
        "",
      ].join("\n"),
    );
  }

  if (env.isProduction) {
    // Avisos que não impedem o boot, mas mudam o comportamento observado.
    if (!env.databaseUrlDirect) {
      console.warn(
        "[pricall] DATABASE_URL_UNPOOLED não configurada: o tempo real entre " +
          "instâncias fica limitado. A interface revalida a cada reconexão.",
      );
    }
    if (env.mail.provider === "log") {
      console.warn(
        "[pricall] MAIL_PROVIDER=log: convites e recuperação de senha não " +
          "serão enviados por e-mail — apenas registrados no log do servidor.",
      );
    }
  }

  console.info(
    `[pricall] iniciado · ambiente=${env.nodeEnv} · banco=${env.databaseDriver} · e-mail=${env.mail.provider} · ia=${env.ai.provider}`,
  );
}
