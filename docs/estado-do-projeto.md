# Estado do projeto

Fotografia honesta de onde o PRICALL parou, escrita para quem retomar depois —
inclusive você mesmo, daqui a alguns meses.

Documentação otimista custa caro: leva a pessoa a confiar em algo que nunca foi
verificado. Por isso este documento separa o que **foi visto funcionando em
produção** do que **existe no código mas ninguém exercitou**.

**No ar:** <https://pricall.vercel.app>
**Última sessão:** 08/08/2026

---

## Funciona, verificado em produção

Tudo aqui foi exercitado com WhatsApp real, número real, cliente real.

| | |
| --- | --- |
| Banco | Supabase, 28 tabelas, RLS ativo em todas |
| Aplicação | Vercel, conectada ao banco (`banco=postgres` no boot) |
| Recebimento | mensagem do cliente entra sozinha na central |
| Envio | resposta sai pela aplicação, com confirmação de entrega |
| Atribuição | conversa vai para um vendedor, e o outro vê "já em atendimento" |
| Distribuição | manual, menor carga, rodízio ou primeiro a assumir |
| Contatos | agenda com busca; iniciar conversa com quem já escreveu |
| Resposta pelo celular | entra no histórico como saída |
| Webhook protegido | recusa 400/401 para quem não comprova origem |
| Evolution | instância `pricall` pareada, estado `open` |

---

## Funciona pela metade

### Tempo real

A mensagem nova aparece na conversa aberta, mas pela **revalidação de 20
segundos**, não pelo evento instantâneo.

A entrega imediata depende da ponte `pg_notify` estar ativa na mesma instância
do Vercel que atende o SSE daquele navegador. Em serverless as requisições se
espalham entre instâncias, e cada reconexão do SSE cai numa nova.

**Nunca confirmei essa ponte ativa em produção.** Ela agora registra sucesso e
falha no log (`[pricall] ponte de tempo real ativa` / `indisponível`) — é por
aí que a investigação deve começar.

O sintoma é o descrito: funciona, mas "demora".

---

## Existe no código, nunca foi exercitado

Nada aqui está quebrado que se saiba. Também não está provado.

| Recurso | Situação |
| --- | --- |
| **E-mail** | `MAIL_PROVIDER=log` — convite e recuperação de senha só aparecem no log do Vercel. Vira bloqueio no dia em que você convidar alguém por e-mail. |
| **Sentry** | sem DSN configurado; a biblioteca nem é carregada |
| **Cron** | 1× por dia (limite do plano Hobby). Alerta de SLA, reatribuição de conversa parada e lembrete de retorno ficam lentos |
| **Kanban** | interface pronta, nunca usada com volume real |
| **Agenda** | idem |
| **Relatórios** | idem |
| **Importar/exportar CSV** | implementado, nunca testado |
| **IA assistiva** | em `mock` — sugere sem chamar serviço externo. Com `ANTHROPIC_API_KEY` passa a usar Claude |
| **Segundo número** | o cadastro existe e foi preenchido; a instância `pricall-calixto` não chegou a ser criada na Evolution |

---

## Pendências de segurança

Em ordem de urgência.

### 1. Credenciais que passaram pelo chat

A senha do banco Supabase e a apikey da Evolution foram enviadas na conversa.
Ambas devem ser trocadas antes de a central receber dado de cliente de verdade
em volume.

- **Senha do banco:** Supabase › Settings › Database › Reset password, depois
  atualizar `DATABASE_URL` e `DATABASE_URL_UNPOOLED` no Vercel
- **Apikey da Evolution:** trocar `AUTHENTICATION_API_KEY` no servidor dela e
  atualizar `EVOLUTION_API_KEY` no Vercel

### 2. Apikey escrita dentro dos fluxos n8n

O fluxo `PREVISA | Entrada WhatsApp → Manifestação` tem a apikey da Evolution
como valor de header **direto no node**, não em credencial. Quem exportar o
workflow leva a chave junto.

Vale conferir os outros seis fluxos ativos pelo mesmo padrão.

### 3. Deploy Hook

Criado durante a depuração e nunca revogado. Vercel › Settings › Git › Deploy
Hooks › Revoke. Não serve mais para nada.

### 4. Repositório público

Não há segredo no código — o banco guarda apenas referências a variáveis de
ambiente. Mas a modelagem completa e a especificação do negócio estão
visíveis.

---

## Decisões de arquitetura, e o que custaram

Registradas porque cada uma explica um comportamento que, sem contexto, parece
defeito.

**Serverless (Vercel).** Barato e sem servidor para cuidar. Em troca: o tempo
real precisa de uma ponte entre instâncias, o pool de conexões tem que ser
pequeno, e funções longas são cortadas. Boa parte da dificuldade desta sessão
saiu daqui.

**PGlite em desenvolvimento.** Postgres em WASM, roda o sistema inteiro sem
serviço externo. Permitiu testes de integração contra Postgres de verdade em
vez de mock — foi o que pegou quatro bugs que mock nenhum pegaria.

**Token do webhook aceito na query string.** O cabeçalho é preferível, mas a
maioria dos painéis do Evolution Manager não tem campo para cabeçalho
personalizado. A alternativa real não era "usar cabeçalho", era "configurar
por linha de comando" — ou pior, deixar aberto.

**Interface + adaptadores para WhatsApp, IA e e-mail.** Trocar Evolution por
Cloud API, ou `mock` por Anthropic, é mudar variável de ambiente. Nenhum
chamador muda.

---

## Onde procurar quando algo quebrar

1. **`docs/colocar-no-ar.md`, seção "Armadilhas que já custaram caro"** — cada
   uma com o sintoma que a identifica. Comece por aí.
2. **Fluxo Diagnóstico** no GitHub Actions — verifica Evolution, estado da
   instância e as proteções do webhook, em segundos.
3. **Vercel › Logs** — a linha `[pricall] iniciado` diz banco, e-mail, IA e
   Sentry em uso.
4. **Configurações › Integridade e logs** — horário do último webhook
   recebido. Sem registro, o problema está antes da aplicação.

---

## Se for retomar

Na ordem em que eu faria:

1. Trocar as duas credenciais expostas
2. Confirmar se a ponte de tempo real sobe (procurar `ponte de tempo real` no
   log) — é o que separa "instantâneo" de "20 segundos"
3. Ligar o e-mail, antes de convidar o primeiro vendedor
4. Ligar o Sentry, para parar de descobrir erro por relato
5. Exercitar kanban, agenda e relatórios com dado real

Os passos 1 e 3 são os únicos que viram bloqueio de verdade. O resto é
melhoria.

---

## Números

```
121 testes automatizados, todos passando
 34 rotas compiladas
104 kB de JavaScript compartilhado
 28 tabelas, com RLS em todas
```

Os testes cobrem regras de distribuição, permissões por perfil, transições de
status, privacidade na IA, sanitização do Sentry, autenticidade do webhook e os
fluxos de ponta a ponta contra Postgres real — não mock.

Vale dizer o que eles **não** cobrem: nada de interface, nada de integração
real com Evolution, nada de tempo real. Os defeitos que mais custaram nesta
sessão estavam justamente nessas três áreas.
