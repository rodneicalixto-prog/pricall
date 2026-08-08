# Criar o banco no Supabase

Guia curto para você criar o projeto e as tabelas pela interface, sem
precisar rodar nada da linha de comando.

O SQL completo está em [`setup-supabase.sql`](./setup-supabase.sql) — 704
linhas, cria tudo de uma vez.

---

## 1. Criar o projeto

1. Acesse <https://supabase.com/dashboard> e clique em **New project**
2. Preencha:
   - **Name:** `pricall`
   - **Database Password:** gere uma forte e **guarde** — você vai precisar
   - **Region:** `South America (São Paulo)` — menor latência para o Brasil
3. Aguarde 2 a 3 minutos até o projeto ficar verde (*Active*)

---

## 2. Criar as tabelas

1. No menu lateral, abra **SQL Editor**
2. Clique em **New query**
3. Abra o arquivo `docs/setup-supabase.sql`, copie **tudo** e cole
4. Clique em **Run** (ou `Ctrl+Enter`)

Deve terminar com *Success. No rows returned*. Se aparecer erro, me mande a
mensagem — não tente rodar de novo por cima, porque o `CREATE TABLE` falha
quando a tabela já existe.

### Conferir

Ainda no SQL Editor, rode:

```sql
select count(*) as tabelas from pg_tables where schemaname = 'public';
```

Resultado esperado: **29**.

Em **Table Editor** você deve ver `organizations`, `users`, `conversations`,
`messages` e as demais.

---

## 3. Pegar as duas URLs de conexão

Em **Project Settings › Database › Connection string**, aba **URI**.

Você precisa de **duas** URLs diferentes:

| Onde pegar             | Porta | Variável no Vercel      |
| ---------------------- | ----- | ----------------------- |
| **Transaction pooler** | 6543  | `DATABASE_URL`          |
| **Session pooler**     | 5432  | `DATABASE_URL_UNPOOLED` |

As duas saem do **mesmo host** (`…pooler.supabase.com`) e diferem só na porta.

Em cada uma, troque `[YOUR-PASSWORD]` pela senha do passo 1 e acrescente
`?sslmode=require` no final.

Exemplo do formato final:

```
postgresql://postgres.xxxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require
postgresql://postgres.xxxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

> **Use uma senha só com letras e números.** A senha vai no meio de uma URL, e
> `@`, `:`, `/`, `?`, `#` e `%` têm significado ali. Uma senha como
> `Abc@123` faz o endereço ser lido errado e a conexão falha reclamando de
> **host inválido** — nada indica que o problema é a senha, e é aí que se
> perde uma tarde. Se já criou uma assim, é mais rápido resetar em
> **Settings › Database › Reset database password** do que escapar caractere
> a caractere.

### Por que duas?

O **transaction pooler** (6543) é o que aguenta o vai-e-vem de conexões curtas
do serverless — sem ele, o Vercel esgota as conexões do banco rapidamente. Mas
o modo transação **descarta `LISTEN/NOTIFY`**, que é o mecanismo pelo qual as
instâncias avisam umas às outras que chegou mensagem nova.

O **session pooler** (5432) mantém a subscrição, porque a conexão fica
reservada à sessão inteira. É ele que sustenta o tempo real.

### E a "Direct connection"?

O Supabase também oferece uma conexão direta, em `db.<ref>.supabase.co:5432`.
Ela igualmente preserva o `LISTEN`, mas **atende só em IPv6** — e as funções do
Vercel saem por IPv4. A conexão simplesmente não se estabelece, a menos que
você contrate o add-on de IPv4.

Por isso a recomendação aqui é o session pooler: mesmo comportamento para o
tempo real, e alcançável pela rede do Vercel.

Configurando só a primeira URL o sistema funciona — mas a mensagem nova só
aparece na tela do colega depois de alguns segundos, quando a interface
revalida sozinha. Não é o fim do mundo, é uma degradação evitável.

---

## 4. Colar no Vercel

Em **Settings › Environment Variables** do projeto `pricall`, adicione as duas
variáveis acima. Depois volte ao
[guia de deploy](./deploy-vercel.md#3-aplicação-no-vercel) para as demais.

> Nunca me mande as senhas ou URLs completas pelo chat. Elas vão direto do
> Supabase para o Vercel.

---

## Se precisar recomeçar

Rodou o SQL pela metade ou deu erro no meio? O caminho mais limpo é apagar o
projeto no Supabase e criar outro — leva 3 minutos e evita ficar caçando o que
foi criado e o que não foi.

Se preferir limpar sem recriar o projeto, rode no SQL Editor:

```sql
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
drop schema if exists drizzle cascade;
```

E então execute o `setup-supabase.sql` de novo, do zero.
