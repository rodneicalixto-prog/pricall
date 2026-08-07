# Deploy no Vercel com Evolution API

Guia do caminho completo: banco, aplicação, WhatsApp pela Evolution e e-mail
pelo Gmail. Escrito para o cenário de **piloto interno** — poucos usuários,
uso diário para conhecer a plataforma e encontrar problemas.

Tempo estimado: 40 a 60 minutos, contando a criação das contas.

---

## Antes de começar

Você vai precisar de:

- Conta no Vercel (o plano Hobby atende o piloto)
- Um PostgreSQL gerenciado — **Supabase** ou **Neon**, ambos com plano gratuito
- Uma instância da **Evolution API** rodando e acessível pela internet
- Uma conta Gmail para os e-mails do sistema

> A Evolution precisa estar em um servidor que fique de pé o tempo todo (VPS,
> Railway, Docker num servidor seu). Ela mantém a sessão do WhatsApp, então
> não pode ser serverless.

---

## 1. Banco de dados

### Supabase

1. Crie um projeto em <https://supabase.com/dashboard>. Anote a senha do banco.
2. Em **Project Settings › Database › Connection string**, copie **duas** URLs:

| Para que serve            | Onde pegar                        | Vai na variável         |
| ------------------------- | --------------------------------- | ----------------------- |
| Consultas da aplicação    | *Transaction pooler* — porta 6543 | `DATABASE_URL`          |
| Tempo real (LISTEN)       | *Direct connection* — porta 5432  | `DATABASE_URL_UNPOOLED` |

**As duas são necessárias.** O pooler em modo transação é o que aguenta o
vai-e-vem de conexões do serverless, mas ele descarta `LISTEN/NOTIFY` — que é
como as instâncias avisam umas às outras que chegou mensagem nova. Sem a
conexão direta, o tempo real fica preso a uma instância só.

Acrescente `?sslmode=require` no fim de cada URL.

### Neon

Mesma ideia: a URL "pooled" vai em `DATABASE_URL` e a "unpooled" em
`DATABASE_URL_UNPOOLED`.

---

## 2. Migrações

Rode da sua máquina, uma vez, apontando para o banco novo:

```bash
git clone <seu-repositório> && cd pricall
npm install

export DATABASE_URL="postgres://…5432/postgres?sslmode=require"   # conexão direta
npm run db:migrate
psql "$DATABASE_URL" -f drizzle/policies.sql
```

Use a **conexão direta** (5432) para migrar — DDL pelo pooler dá problema.

O `policies.sql` liga o Row Level Security. Ele é a segunda camada de
isolamento entre empresas; a primeira é a camada de serviço da aplicação.

---

## 3. Aplicação no Vercel

1. **Add New › Project** e importe o repositório.
2. O Next.js é detectado sozinho; não mude build nem output.
3. Antes do primeiro deploy, cadastre as variáveis de ambiente abaixo.

### Variáveis obrigatórias

```
APP_URL=https://SEU-PROJETO.vercel.app
NODE_ENV=production

DATABASE_URL=postgres://…6543/postgres?sslmode=require
DATABASE_URL_UNPOOLED=postgres://…5432/postgres?sslmode=require

SESSION_SECRET=<gere com: openssl rand -base64 48>
CRON_SECRET=<gere com: openssl rand -base64 32>
```

### Evolution API

```
EVOLUTION_API_URL=https://sua-evolution.com.br
EVOLUTION_API_KEY=<a apikey global da sua instalação>
EVOLUTION_INSTANCE=<nome da instância>
EVOLUTION_WEBHOOK_TOKEN=<gere com: openssl rand -hex 24>
```

`EVOLUTION_WEBHOOK_TOKEN` é inventado por você. Serve para o PRICALL
recusar webhooks que não venham da sua Evolution — a Evolution não assina o
corpo da requisição, então esse token é a proteção.

### E-mail pelo Gmail

```
MAIL_PROVIDER=smtp
MAIL_FROM=PRICALL <seu-email@gmail.com>
MAIL_SMTP_HOST=smtp.gmail.com
MAIL_SMTP_PORT=587
MAIL_SMTP_USER=seu-email@gmail.com
MAIL_SMTP_PASSWORD=<Senha de App, 16 caracteres>
```

A senha **não** é a da sua conta Google. É uma Senha de App:

1. Ative a verificação em duas etapas em <https://myaccount.google.com/security>
2. Acesse <https://myaccount.google.com/apppasswords>
3. Crie uma senha para "PRICALL"
4. Cole os 16 caracteres em `MAIL_SMTP_PASSWORD` (com ou sem espaços, tanto faz)

**Limites do Gmail:** cerca de 500 e-mails por dia numa conta comum, 2.000 no
Workspace. O PRICALL só manda e-mail em convite, recuperação de senha e reset
pelo administrador — para uso interno sobra folga. Quando a equipe inteira
entrar, migre para `MAIL_PROVIDER=resend` (plano gratuito de 3.000/mês); é só
trocar a variável, o código já suporta.

Deixe `MAIL_PROVIDER=log` se quiser adiar o e-mail: o sistema segue
funcionando e os links aparecem no log do Vercel e na própria tela.

### Opcionais

```
AI_PROVIDER=anthropic          # padrão: mock, funciona sem chave
ANTHROPIC_API_KEY=
AI_MODEL=claude-sonnet-5
DEMO_MODE_ENABLED=false        # desliga o simulador em produção
LOG_LEVEL=info
```

---

## 4. Cron

O `vercel.json` do repositório já agenda `/api/jobs` a cada 5 minutos. O
Vercel autentica com `Authorization: Bearer $CRON_SECRET`, e o endpoint
aceita esse formato.

Sem o cron, o sistema funciona — mas **nada disso acontece**: alerta de SLA,
reatribuição de conversa abandonada, lembrete de retorno agendado, marcação de
vendedor ausente, limpeza de sessões. Não dá erro; simplesmente não roda.

> O plano Hobby permite cron uma vez por dia. Para rodar a cada 5 minutos é
> preciso o plano Pro. Se ficar no Hobby, use um agendador externo
> (cron-job.org, GitHub Actions) chamando:
>
> ```
> curl -X POST https://SEU-PROJETO.vercel.app/api/jobs \
>   -H "x-pricall-job-token: $CRON_SECRET"
> ```

---

## 5. Webhook da Evolution

Com a aplicação no ar, aponte a Evolution para ela:

```bash
curl -X POST "https://sua-evolution.com.br/webhook/set/SUA_INSTANCIA" \
  -H "apikey: SUA_APIKEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://SEU-PROJETO.vercel.app/api/webhooks/whatsapp",
      "webhookByEvents": false,
      "headers": { "x-evolution-token": "SEU_EVOLUTION_WEBHOOK_TOKEN" },
      "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE"]
    }
  }'
```

O header `x-evolution-token` precisa bater exatamente com
`EVOLUTION_WEBHOOK_TOKEN`. Sem ele o PRICALL responde 401 — e é isso que você
quer, porque significa que a proteção está funcionando.

---

## 6. Primeiro acesso

1. Abra `https://SEU-PROJETO.vercel.app/criar-empresa` e crie sua conta.
2. Siga o onboarding. Na etapa do WhatsApp escolha **Evolution API** e informe:
   - URL: a mesma de `EVOLUTION_API_URL`
   - Instância: a mesma de `EVOLUTION_INSTANCE`
   - Referência ao segredo: `env:EVOLUTION_API_KEY`
3. Em **Configurações › Integração do WhatsApp**, clique em **Testar conexão**.
   O estado da instância deve voltar como `open`.
4. Mande uma mensagem de outro celular para o número conectado. Ela deve
   aparecer na central em poucos segundos.

> A referência ao segredo é `env:EVOLUTION_API_KEY`, não a chave em si. O banco
> nunca guarda credencial — só o nome da variável de ambiente onde ela está.

---

## 7. Verificação

| O quê                    | Como conferir                                              |
| ------------------------ | ---------------------------------------------------------- |
| Boot sem avisos          | Vercel › Logs, procure a linha `[pricall] iniciado`         |
| Banco conectado          | O login funciona                                            |
| Webhook chegando         | Configurações › Integridade e logs › webhooks recebidos     |
| Envio funcionando        | Responda uma conversa e veja o status virar entregue        |
| Tempo real               | Duas abas com usuários diferentes na mesma conversa         |
| E-mail                   | Convide alguém e veja se o e-mail chega                     |
| Cron                     | Vercel › Cron Jobs, veja a última execução                  |

---

## Limitações conhecidas do serverless

Nada aqui impede o piloto, mas é bom saber de antemão para não confundir com
defeito.

**Tempo real reconecta a cada 60 segundos.** O Vercel encerra funções longas.
A aplicação reconecta sozinha e revalida a tela ao reconectar, então no pior
caso a informação atrasa alguns segundos. O indicador no cabeçalho mostra
"Reconectando" durante a troca — é normal, não é falha.

**Rate limiting é por instância.** Os limites de tentativa de login e envio
são contados na memória de cada instância; com várias instâncias, o limite
efetivo é maior que o configurado. Para uso interno não muda nada. Se virar
produção séria, troque `src/lib/rate-limit.ts` por Redis mantendo a mesma
assinatura — os chamadores não mudam.

**Cada SSE aberto consome uma conexão direta do banco** (para o `LISTEN`). O
Supabase gratuito permite cerca de 60 conexões diretas. Com uma equipe pequena
sobra espaço; com 50 pessoas simultâneas, é hora de olhar isso.

**A Evolution precisa estar de pé.** Se ela cair, as mensagens não chegam ao
PRICALL. O painel de integridade mostra o horário do último webhook — se
parou, o problema costuma estar lá, não aqui.

---

## Quando a equipe entrar de verdade

Na ordem de prioridade:

1. **Sentry** — `SENTRY_DSN`. Com mais gente usando, você quer saber do erro
   antes de alguém reclamar.
2. **Rate limit em Redis** — Upstash tem plano gratuito e conversa bem com o Vercel.
3. **E-mail em serviço transacional** — Resend ou SendGrid, com domínio próprio.
   Entregabilidade melhor e sem o limite diário do Gmail.
4. **Backup do banco** — o Supabase faz automático no plano pago; no gratuito,
   agende um `pg_dump`.
5. **Ambiente de homologação** — um segundo projeto no Vercel, com banco e
   instância Evolution próprios, para testar antes de subir.
