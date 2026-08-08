# Colocar o PRICALL no ar

Checklist sequencial, do estado atual até o sistema recebendo mensagem de
WhatsApp de verdade. Cada passo tem como conferir se deu certo antes de seguir
para o próximo — se um falhar, não adianta continuar.

| # | Passo | Onde | Estado |
| - | ----- | ---- | ------ |
| 1 | Criar as tabelas | Supabase | ✅ 28 tabelas |
| 2 | Conferir as tabelas | Supabase | ✅ 28/28/28 |
| 3 | Apontar o Vercel para a branch certa | Vercel | ✅ feito |
| 4 | Cadastrar as variáveis de ambiente | Vercel | ✅ dez variáveis |
| 5 | Deploy e conferir o boot | Vercel | ✅ `banco=postgres` |
| 6 | Criar a empresa e o primeiro usuário | Aplicação | ✅ Calixto Soluções |
| 7 | Conectar a Evolution | Evolution + aplicação | ✅ instância `open` |
| 8 | Mensagem de ponta a ponta | Celular | ✅ recebida e respondida |

**No ar:** <https://pricall.vercel.app/entrar>

O piloto está de pé. Mensagem de cliente entra na central sozinha, é atribuída,
respondida pela aplicação e a confirmação de entrega volta.

Daqui em diante este documento serve para duas coisas: montar um segundo
ambiente do zero (homologação, outra empresa) e consultar as armadilhas da
seção final, que custaram caro para descobrir.

O boot confirmou o banco:

```
[pricall] iniciado · ambiente=production · banco=postgres · e-mail=log · ia=mock · sentry=desligado
```

`banco=postgres` é o Supabase respondendo.

> **Uma variável nova só vale no próximo deploy.** Depois de salvar qualquer
> coisa em Environment Variables, é preciso um Redeploy (ou qualquer push na
> branch de produção) para a função enxergar o valor. Salvar sozinho não muda
> nada no que já está no ar.

---

## 2. Conferir as tabelas

No **SQL Editor** do Supabase:

```sql
select
  (select count(*) from pg_tables where schemaname = 'public') as tabelas,
  (select count(*) from pg_tables where schemaname = 'public' and rowsecurity) as com_rls,
  (select count(*) from pg_policies where schemaname = 'public') as politicas;
```

Esperado: **28 / 28 / 28**.

Se `com_rls` vier menor que `tabelas`, o script parou no meio — o Row Level
Security é a última parte do arquivo, e tabela sem ele fica sem isolamento
entre empresas no banco. Nesse caso vale recomeçar limpo, conforme
[a última seção do guia do Supabase](./setup-supabase.md#se-precisar-recomeçar).

(A `__drizzle_migrations` também é criada, mas no schema `drizzle` — por isso
não entra nessa conta.)

---

## 3. Apontar o Vercel para a branch certa

**Este é o passo que hoje bloqueia tudo o mais.**

O projeto `pricall` no Vercel está publicando a branch `main`, que só contém o
documento de especificação — nenhum código. Por isso o Vercel nem detectou que
é um projeto Next.js (o campo *Framework* está vazio) e o site no ar não é a
aplicação.

O código está em `claude/pricall-whatsapp-central-6g7i3a`.

Em **Settings › Git › Production Branch**, troque `main` por:

```
claude/pricall-whatsapp-central-6g7i3a
```

Salve. O próximo deploy sai da branch certa.

> A alternativa é trazer o código para a `main` — mais limpo a longo prazo,
> porque `main` é a convenção que todo mundo espera. Mas exige mexer na branch
> principal, e isso é decisão sua. Trocar a branch de produção resolve agora e
> pode ser revertido depois sem perda.

Depois de salvar, confirme em **Settings › General** que o *Framework Preset*
passou a mostrar **Next.js**. Se continuar vazio, force um redeploy para o
Vercel reinspecionar o repositório.

---

## 4. Cadastrar as variáveis de ambiente

Em **Settings › Environment Variables**, ambiente **Production**.

### Obrigatórias — sem elas o sistema não sobe direito

| Variável | De onde vem |
| -------- | ----------- |
| `APP_URL` | `https://pricall.vercel.app` |
| `DATABASE_URL` | Supabase › Connection string › **Transaction pooler (6543)** |
| `DATABASE_URL_UNPOOLED` | Supabase › Connection string › **Session pooler (5432)** |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `CRON_SECRET` | `openssl rand -base64 32` |

Nas duas URLs do banco: troque `[YOUR-PASSWORD]` pela senha do projeto e
acrescente `?sslmode=require` no fim. As duas saem do **mesmo host**
(`…pooler.supabase.com`) e mudam só na porta — 6543 e 5432.

> **A senha não pode ter caracteres especiais.** Gere uma só com letras e
> números. Se ela contiver `@`, `:`, `/`, `?`, `#` ou `%`, a URL fica ambígua e
> a conexão falha com erro de host inválido — que não parece problema de senha,
> e por isso custa caro para diagnosticar.

**Não cadastre `DATABASE_DRIVER`.** Com `DATABASE_URL` presente, a aplicação já
escolhe Postgres sozinha. Se essa variável existir com o valor `pglite`, o boot
reclama e o banco real é ignorado.

### Evolution API

| Variável | Valor |
| -------- | ----- |
| `EVOLUTION_API_URL` | URL da sua instalação, sem barra no fim |
| `EVOLUTION_API_KEY` | a *apikey* global da Evolution |
| `EVOLUTION_INSTANCE` | nome da instância |
| `EVOLUTION_WEBHOOK_TOKEN` | você inventa: `openssl rand -hex 24` |

O `EVOLUTION_WEBHOOK_TOKEN` não vem de lugar nenhum — é um segredo que você
cria. A Evolution não assina o corpo do webhook, então esse token é o que
impede qualquer um de mandar mensagem falsa para o PRICALL.

### E-mail pelo Gmail

| Variável | Valor |
| -------- | ----- |
| `MAIL_PROVIDER` | `smtp` |
| `MAIL_FROM` | `PRICALL <rodneisaudeessencial@gmail.com>` |
| `MAIL_SMTP_HOST` | `smtp.gmail.com` |
| `MAIL_SMTP_PORT` | `587` |
| `MAIL_SMTP_USER` | `rodneisaudeessencial@gmail.com` |
| `MAIL_SMTP_PASSWORD` | Senha de App de 16 caracteres |

A Senha de App sai de <https://myaccount.google.com/apppasswords> e exige a
verificação em duas etapas ligada. **Não é a senha da conta Google.**

Quer adiar o e-mail? Use `MAIL_PROVIDER=log`. O sistema funciona igual; os
links de convite e de recuperação de senha aparecem na própria tela e no log do
Vercel, em vez de chegarem por e-mail.

### Sentry — recomendado no piloto

| Variável | Valor |
| -------- | ----- |
| `SENTRY_DSN` | DSN do projeto Next.js criado em sentry.io |
| `NEXT_PUBLIC_SENTRY_DSN` | o mesmo valor |

Sem DSN, a biblioteca nem é baixada pelo navegador. Com DSN, todo evento passa
pela limpeza de `src/lib/observability.ts` antes de sair: cookies, tokens,
telefone e conteúdo de mensagem viram `[oculto]`.

### Deixe de fora

`DEMO_MODE_ENABLED` — em produção o padrão já é desligado.
`AI_PROVIDER` — o modo `mock` funciona sem chave e sem chamada externa.

---

## 5. Deploy e conferir o boot

O que dispara o deploy é **um commit novo na branch de produção**. Basta
qualquer push para `claude/pricall-whatsapp-central-6g7i3a`.

**Não use o botão Redeploy logo depois de trocar a branch no passo 3.** Ele
reconstrói o *mesmo commit* do deploy anterior — que ainda é o da branch
antiga. O deploy fica verde e o site continua sem a aplicação. Depois que
existir ao menos um deploy da branch certa, o Redeploy volta a ser útil: é
assim que se aplica uma variável de ambiente nova sem precisar de commit.

### Se o deploy simplesmente não aparecer

Esta armadilha custou horas de diagnóstico, então fica registrada.

O Vercel valida o `vercel.json` **no momento de criar o deployment**. Se o
arquivo pedir algo acima do plano, ele **recusa o deploy inteiro — e a recusa é
silenciosa**: nada aparece na lista de Deployments, nem como falha. A impressão
é de que os pushes pararam de chegar, e o instinto manda ir investigar a
conexão com o GitHub. É o lugar errado.

No plano Hobby, dois campos derrubam o deploy:

| Campo | Por quê |
| ----- | ------- |
| `"regions"` | escolher região é recurso do plano Pro |
| `"crons"` mais frequente que diário | Hobby aceita no máximo 1× por dia |

O sintoma que identifica esse caso: **um Deploy Hook responde `201` com
`state: PENDING` e nunca vira deploy**. A requisição foi aceita, a validação
recusou depois. Se isso acontecer, o problema está no `vercel.json`, não no
GitHub.

### Conferir o boot

Em **Logs**, procure a linha:

```
[pricall] iniciado · ambiente=production · banco=postgres · e-mail=smtp · ia=mock · sentry=ativo
```

O que cada pedaço denuncia:

- `banco=pglite` → `DATABASE_URL` não chegou na função. Confira o ambiente
  (Production) da variável e refaça o deploy.
- `e-mail=log` quando você configurou SMTP → falta `MAIL_SMTP_PASSWORD`.
- Um bloco `configuração de produção incompleta` → cada linha diz o que falta.

Um aviso sobre `DATABASE_URL_UNPOOLED` ausente não impede nada: significa só
que a mensagem nova demora alguns segundos a mais para aparecer na tela do
colega.

Vale reparar que essa linha aparece **na primeira requisição** que acorda a
função, não no fim do build. Se os Logs estiverem vazios, abra qualquer página
do site e olhe de novo.

---

## 6. Criar a empresa e o primeiro usuário

Abra `https://pricall.vercel.app/criar-empresa`.

O primeiro cadastro cria a empresa e o usuário administrador. Daí em diante,
entrar é por convite — não existe auto-cadastro, e é assim que deve ser numa
central de atendimento.

Siga o onboarding: setor, horário de funcionamento, primeiro vendedor.

---

## 7. Conectar a Evolution

Na etapa de WhatsApp do onboarding (ou depois, em **Configurações › Integração
do WhatsApp**), escolha **Evolution API** e informe:

- **URL:** a mesma de `EVOLUTION_API_URL`
- **Instância:** a mesma de `EVOLUTION_INSTANCE`
- **Referência ao segredo:** `env:EVOLUTION_API_KEY`

O último campo é literalmente o texto `env:EVOLUTION_API_KEY`, não a chave. O
banco guarda só o nome da variável de ambiente onde a chave está; a chave nunca
é gravada.

Clique em **Testar conexão**. O estado da instância deve voltar `open`.

Agora aponte a Evolution para a aplicação. Sem isto as mensagens chegam ao
WhatsApp mas não entram na central.

### Pelo Evolution Manager (recomendado)

No painel da instância, procure **Events › Webhook**:

| Campo | Valor |
| ----- | ----- |
| **Enabled** | ligado |
| **URL** | `https://pricall.vercel.app/api/webhooks/whatsapp?token=SEU_TOKEN` |
| **Webhook by Events** | desligado |
| **Webhook Base64** | desligado |
| **Events** | só `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `SEND_MESSAGE` |

`SEU_TOKEN` é o valor de `EVOLUTION_WEBHOOK_TOKEN`, colado no fim da URL.

> **Por que o token vai na URL?** A maioria dos painéis do Evolution Manager
> não tem campo para cabeçalho personalizado. O PRICALL aceita o token pelo
> cabeçalho `x-evolution-token` (preferível, porque não aparece em log de
> servidor) ou pela query string — e é essa segunda forma que permite
> configurar tudo pela tela.

Ligar mais eventos do que os três só gera tráfego que a aplicação descarta.

### Pela API, se preferir cabeçalho

```bash
curl -X POST "https://SUA-EVOLUTION/webhook/set/SUA_INSTANCIA" \
  -H "apikey: SUA_APIKEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://pricall.vercel.app/api/webhooks/whatsapp",
      "webhookByEvents": false,
      "headers": { "x-evolution-token": "SEU_EVOLUTION_WEBHOOK_TOKEN" },
      "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE"]
    }
  }'
```

### Conferir a proteção

O webhook é público, então precisa recusar tudo que não comprove origem:

```bash
# Envelope desconhecido → 400
curl -i -X POST https://pricall.vercel.app/api/webhooks/whatsapp -d '{}'

# Envelope da Evolution sem token → 401
curl -i -X POST https://pricall.vercel.app/api/webhooks/whatsapp \
  -H 'content-type: application/json' \
  -d '{"event":"messages.upsert","instance":"pricall","data":{}}'
```

Um **200** em qualquer um dos dois significa que qualquer pessoa na internet
consegue criar conversa forjada na sua central. O fluxo **Diagnóstico** testa
os dois automaticamente.

---

## 8. Mensagem de ponta a ponta

De outro celular, mande uma mensagem para o número conectado.

1. A conversa aparece na central em poucos segundos
2. Você assume o atendimento — outro usuário passa a ver "já em atendimento"
3. Responde pela aplicação e a mensagem chega no celular
4. O status vira entregue, depois lido

Fez os quatro? O caminho todo está funcionando: webhook → banco → tempo real →
envio → confirmação.

Se travar no passo 1, olhe **Configurações › Integridade e logs**: ele mostra o
horário do último webhook recebido. Sem nenhum registro, o problema está entre
a Evolution e o Vercel, não dentro da aplicação.

---

## Diagnóstico automático

Dois fluxos no GitHub cuidam do que exige alcançar Vercel e Evolution de fora:

| Fluxo | O que faz |
| ----- | --------- |
| **Diagnóstico** | verifica a Evolution, o estado da instância e se o webhook recusa quem não comprova origem |
| **Ambiente** | empurra segredos do GitHub para as variáveis do Vercel e dispara deploy |

Rodam em **Actions › [fluxo] › Run workflow**, ou alterando o arquivo
correspondente em `.github/gatilhos/`.

Dependem de dois secrets em *Settings › Secrets and variables › Actions*:
`VERCEL_TOKEN` e `EVOLUTION_API_KEY`. Sem eles os fluxos avisam o que falta em
vez de quebrar.

Rode o **Diagnóstico** sempre que algo parecer errado — ele separa em segundos
o que é problema da Evolution, do PRICALL ou da rede.

---

## Armadilhas que já custaram caro

Cada uma destas consumiu horas. Estão aqui para a segunda instalação não
repetir a primeira.

**`vercel.json` acima do plano derruba o deploy em silêncio.** `regions` e cron
mais frequente que diário são recursos Pro. No Hobby o Vercel recusa o deploy
na validação e **não registra nada** na lista de Deployments. Parece que os
pushes pararam de chegar. O sintoma que identifica: um deploy hook responde
`201` com `state: PENDING` e nunca vira deploy.

**Redeploy não muda a branch.** Ele reconstrói o *mesmo commit*. Depois de
trocar a Production Branch, só um commit novo publica a branch nova.

**Variável de ambiente só vale no próximo deploy.** Salvar no painel não muda
nada no que já está no ar.

**As duas URLs de banco precisam ter portas diferentes.** `DATABASE_URL` em
**6543** (transaction pooler) e `DATABASE_URL_UNPOOLED` em **5432** (session
pooler). Invertidas, todo o tráfego cai nas 15 vagas do session pooler e o
`EMAXCONNSESSION` derruba até o login.

**Pool local em serverless é 1, não 10.** Cada invocação atende uma requisição
por vez; quem faz o pooling é o pooler do Supabase. Um pool local grande só
multiplica clientes disputando as mesmas vagas.

**Senha de banco só com letras e números.** `@`, `:`, `/`, `?`, `#` e `%` têm
significado dentro da URL. O erro que aparece fala de host inválido e não dá
pista de que a causa é a senha.

**Não use a Direct connection do Supabase no Vercel.** Ela atende só em IPv6 e
as funções saem por IPv4. O session pooler resolve os dois lados.

---

## Depois que estiver rodando

Coisas que não impedem o piloto, mas que você vai querer resolver antes de a
equipe inteira entrar:

**O cron roda uma vez por dia.** O `vercel.json` agenda `/api/jobs` às 8h UTC
(5h de Brasília) porque **é o máximo que o plano Hobby aceita**.

Isso não é uma escolha de conveniência: um `vercel.json` pedindo mais que isso
faz o Vercel **recusar o deploy inteiro** na validação — e a recusa é
silenciosa. O deploy não aparece nem como falha na lista; simplesmente não
existe. O mesmo vale para `"regions"`, que é recurso do plano Pro. Se você
adicionar qualquer um dos dois no Hobby, os deploys param de sair sem
explicação nenhuma.

Com uma execução diária o sistema funciona, mas estes ficam lentos: alerta de
SLA, reatribuição de conversa abandonada, lembrete de retorno agendado,
marcação de vendedor ausente, limpeza de sessão expirada.

Para tê-los de volta a cada 5 minutos sem assinar o Pro, use um agendador
externo (cron-job.org, GitHub Actions) chamando:

```bash
curl -X POST https://pricall.vercel.app/api/jobs \
  -H "x-pricall-job-token: $CRON_SECRET"
```

Ao migrar para o Pro, volte o `schedule` para `*/5 * * * *` e, se quiser menor
latência no Brasil, acrescente `"regions": ["gru1"]`.

**O repositório é público.** Não há segredo no código — o banco guarda apenas
referências a variáveis de ambiente, e as chaves ficam só no Vercel. Ainda
assim, vale deixar privado: a especificação do negócio e a modelagem do banco
estão todas lá.

**Rate limit em memória.** Os limites de tentativa de login e de envio são
contados por instância. Com várias instâncias no ar, o limite efetivo é maior
que o configurado. Para uso interno não muda nada; quando virar produção séria,
troque `src/lib/rate-limit.ts` por Redis mantendo a mesma assinatura — nenhum
chamador precisa mudar.

**Conexões do banco — o limite real é 15.** O *session pooler* do Supabase
aceita 15 clientes simultâneos, não as ~60 da conexão direta. Estourar esse
número derruba **tudo**, inclusive o login: a consulta da sessão também precisa
de conexão, e o erro que aparece é `EMAXCONNSESSION`.

Por isso, em produção, o pool local é de **uma conexão por instância**. Parece
pouco, mas em serverless cada invocação atende uma requisição por vez — quem
faz o trabalho de pool é o pooler do Supabase. Um `max` maior aqui não acelera
nada e multiplica conexões: dez instâncias mornas com `max: 10` são cem
clientes disputando quinze vagas.

Se o erro voltar, confira antes de mexer em código: as duas URLs precisam ter
portas **diferentes** (6543 e 5432). Com as duas em 5432, todo o tráfego cai no
session pooler e as quinze vagas acabam na hora.

---

Detalhes de cada etapa estão em [deploy-vercel.md](./deploy-vercel.md) e
[setup-supabase.md](./setup-supabase.md).

> Nunca me mande senha, token ou URL de banco completa pelo chat. Esses valores
> vão direto do Supabase, do Gmail e da Evolution para as variáveis de ambiente
> do Vercel.
