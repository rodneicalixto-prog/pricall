import Link from "next/link";
import { Logotipo } from "@/components/logotipo";

export const metadata = { title: "Termos de uso" };

export default function PaginaTermos() {
  return (
    <main id="conteudo-principal" className="mx-auto max-w-3xl px-5 py-10">
      <Link href="/" className="mb-8 inline-block">
        <Logotipo />
      </Link>
      <h1 className="text-2xl font-bold">Termos de uso</h1>
      <p className="mt-1 text-sm text-[var(--texto-2)]">
        Documento modelo. Antes de entrar em produção, submeta este texto à
        revisão jurídica da sua empresa.
      </p>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed">
        <section>
          <h2 className="mb-2 text-base font-semibold">1. Objeto</h2>
          <p>
            O PRICALL é uma plataforma de organização de atendimentos comerciais
            recebidos por WhatsApp. O serviço centraliza conversas, distribui
            atendimentos entre vendedores, registra histórico e gera relatórios.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">2. Conta e responsabilidades</h2>
          <p>
            A empresa contratante é responsável pelo cadastro dos seus usuários,
            pela veracidade dos dados informados e pelo uso das credenciais de
            acesso. Cada usuário deve manter sua senha em sigilo. Ações
            realizadas por uma conta são atribuídas ao seu titular.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">3. Integração com o WhatsApp</h2>
          <p>
            A conexão é feita pela plataforma oficial do WhatsApp Business (Cloud
            API) ou pela Evolution API, conforme escolha da contratante. O
            PRICALL não é afiliado, patrocinado ou endossado pela Meta
            Platforms. A contratante é responsável por cumprir as políticas da
            plataforma que utilizar, incluindo regras sobre janela de
            atendimento e mensagens de modelo.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">4. Uso permitido</h2>
          <p>
            É vedado utilizar o serviço para envio de mensagens não solicitadas
            em massa, conteúdo ilícito, discriminatório ou que viole direitos de
            terceiros. O descumprimento pode levar à suspensão da conta.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">5. Disponibilidade</h2>
          <p>
            O serviço é oferecido em regime de melhor esforço. Podem ocorrer
            interrupções para manutenção ou por indisponibilidade de serviços de
            terceiros, incluindo a própria plataforma do WhatsApp.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">6. Dados</h2>
          <p>
            O tratamento de dados pessoais segue a{" "}
            <Link href="/privacidade" className="text-[var(--primaria)] underline">
              política de privacidade
            </Link>
            . A contratante é a controladora dos dados dos seus clientes; o
            PRICALL atua como operador.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">7. Encerramento</h2>
          <p>
            A contratante pode encerrar a conta a qualquer momento e solicitar a
            exportação dos seus dados antes da exclusão definitiva.
          </p>
        </section>
      </div>
    </main>
  );
}
