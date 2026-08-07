import Link from "next/link";
import { Logotipo } from "@/components/logotipo";

export const metadata = { title: "Política de privacidade" };

export default function PaginaPrivacidade() {
  return (
    <main id="conteudo-principal" className="mx-auto max-w-3xl px-5 py-10">
      <Link href="/" className="mb-8 inline-block">
        <Logotipo />
      </Link>
      <h1 className="text-2xl font-bold">Política de privacidade</h1>
      <p className="mt-1 text-sm text-[var(--texto-2)]">
        Documento modelo, redigido segundo os princípios da LGPD (Lei
        13.709/2018). Submeta à revisão jurídica antes de publicar.
      </p>

      <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed">
        <section>
          <h2 className="mb-2 text-base font-semibold">1. Dados tratados</h2>
          <ul className="list-disc pl-5">
            <li>Dados de usuários: nome, e-mail, telefone, perfil e registros de acesso.</li>
            <li>
              Dados de clientes finais: nome, telefone, mensagens trocadas e
              anotações feitas pela equipe de atendimento.
            </li>
            <li>
              Dados técnicos: endereço IP, navegador e horários de acesso,
              usados para segurança e auditoria.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">2. Finalidade</h2>
          <p>
            Os dados são tratados exclusivamente para viabilizar o atendimento
            comercial, organizar a fila de conversas, medir a produtividade da
            equipe e cumprir obrigações legais. Não há venda de dados a
            terceiros.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">3. Papéis</h2>
          <p>
            A empresa contratante é a <strong>controladora</strong> dos dados dos
            seus clientes. O PRICALL atua como <strong>operador</strong>,
            tratando os dados conforme as instruções da contratante.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">4. Segurança</h2>
          <ul className="list-disc pl-5">
            <li>Tráfego criptografado por HTTPS.</li>
            <li>Senhas armazenadas com derivação de chave (scrypt), nunca em texto aberto.</li>
            <li>Tokens de integração mantidos apenas em variáveis de ambiente.</li>
            <li>Isolamento por empresa aplicado no banco de dados (RLS) e na camada de serviço.</li>
            <li>Registro de auditoria das ações sensíveis.</li>
            <li>Mascaramento opcional de telefone para perfis sem permissão completa.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">5. Inteligência artificial</h2>
          <p>
            Quando a IA assistiva está habilitada, apenas o contexto necessário
            da conversa é enviado ao provedor do modelo, com CPF, CNPJ, e-mail e
            telefone mascarados. As sugestões nunca são enviadas ao cliente
            automaticamente: sempre passam por revisão humana. As conversas não
            são usadas para treinamento sem autorização expressa. O
            administrador pode desativar a IA a qualquer momento.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">6. Retenção</h2>
          <p>
            O prazo de guarda é configurável pela contratante (padrão de 365
            dias após o encerramento do atendimento). Decorrido o prazo, os
            dados são eliminados, ressalvadas as hipóteses legais de guarda
            obrigatória.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">7. Direitos do titular</h2>
          <p>
            O titular pode solicitar confirmação de tratamento, acesso,
            correção, anonimização, portabilidade e eliminação dos seus dados,
            além da revogação de consentimento. As solicitações devem ser
            encaminhadas ao encarregado indicado pela empresa contratante.
          </p>
        </section>
      </div>
    </main>
  );
}
