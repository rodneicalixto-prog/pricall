# PRICALL

Central de atendimento compartilhada para equipes que vendem pelo WhatsApp.

As mensagens recebidas no número da empresa caem em uma caixa de entrada
única, são distribuídas entre os vendedores, ganham um responsável visível e
ficam registradas com histórico completo — sem dois vendedores atenderem o
mesmo cliente sem perceber.

---

## Sumário

- [Início rápido](#início-rápido)
- [Arquitetura](#arquitetura)
- [Banco de dados](#banco-de-dados)
- [Integração com o WhatsApp](#integração-com-o-whatsapp)
- [Segurança](#segurança)
- [Testes](#testes)
- [Deploy](#deploy)
- [Estrutura do projeto](#estrutura-do-projeto)
- [O que já está pronto](#o-que-já-está-pronto)

---

## Início rápido

Requisitos: Node.js 20+ e npm.

```bash
npm install
cp .env.example .env.local     # já funciona sem preencher nada
npm run db:migrate             # cria o esquema
npm run db:seed                # empresa fictícia + dados de demonstração
npm run dev
```

Abra <http://localhost:3000>.

O seed usa **PGlite** — um Postgres completo compilado para WebAssembly,
gravado em `.pgdata/`. Nenhum serviço externo é necessário para rodar o
sistema inteiro, incluindo webhooks e tempo real.

### Acessos da demonstração

| Perfil        | E-mail                        | Senha        |
| ------------- | ----------------------------- | ------------ |
| Administrador | `admin@demo.pricall.app`      | `pricall123` |
| Supervisor    | `supervisor@demo.pricall.app` | `pricall123` |
| Vendedor 1    | `vendedor1@demo.pricall.app`  | `pricall123` |
| Vendedor 2    | `vendedor2@demo.pricall.app`  | `pricall123` |
| Vendedor 3    | `vendedor3@demo.pricall.app`  | `pricall123` |
| Vendedor 4    | `vendedor4@demo.pricall.app`  | `pricall123` |

Abra dois navegadores com vendedores diferentes para ver a fila
compartilhada, o bloqueio de atribuição dupla e as atualizações em tempo real.

Dentro da central, a coluna de filas traz um **simulador** que injeta
mensagens recebidas — é assim que se testa o fluxo completo sem número real.

### Scripts

| Comando              | O que faz                                     |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Servidor de desenvolvimento                   |
| `npm run build`      | Build de produção                             |
| `npm start`          | Servidor de produção                          |
| `npm run typecheck`  | Verificação de tipos                          |
| `npm test`           | Suíte completa (107 testes)                   |
| `npm run db:migrate` | Aplica as migrações                           |
| `npm run db:seed`    | Cria os dados de demonstração                 |
| `npm run db:generate`| Gera nova migração a partir do esquema        |

---

## Arquitetura

```
Navegador / PWA
   │  fetch + SSE
   ▼
Next.js (App Router)
   ├── src/app/(app)/…      telas autenticadas
   ├── src/app/api/…        53 endpoints REST
   └── src/server/services  regras de negócio  ◄── única porta para o banco
           │
           ├── src/modules/whatsapp   mock · Cloud API · Evolution
           ├── src/modules/ai         mock · Anthropic
           └── src/db (Drizzle)  →  PostgreSQL / PGlite
```

**Stack:** Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · Drizzle ORM ·
PostgreSQL · Zod · Vitest.

Três decisões que orientam o resto do código:

**A camada de serviço é a fronteira de segurança.** Nenhum route handler fala
com o banco diretamente. Todo serviço recebe um `AuthContext` e aplica o
escopo do perfil na própria consulta SQL — o frontend esconde botões, mas
quem decide é o servidor.

**O provedor de WhatsApp é uma interface.** `WhatsappProvider` tem três
implementações (mock, Cloud API, Evolution) e o restante do sistema não sabe
qual está ativa. É o que permite rodar tudo em demonstração e trocar de
provedor sem tocar em regra de negócio.

**Tempo real trafega deltas, não estado.** O SSE envia
`{ type: "message.created", conversationId }`; a interface recarrega apenas o
que mudou. Um evento não redesenha a tela inteira.

### Fluxo de uma mensagem recebida

```
Webhook → valida assinatura → registra em integration_events (índice único)
        → localiza conexão e empresa → cria/acha contato
        → cria/reabre conversa → grava mensagem → aplica regra de distribuição
        → notifica o vendedor → publica evento em tempo real
```

A idempotência não é convenção: é um índice único em
`(provider, external_event_id)`. Webhook repetido é descartado pelo banco.

### Controle de concorrência

| Risco                                   | Como é impedido                                                        |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Dois vendedores assumem a mesma conversa | `UPDATE … WHERE assigned_user_id IS NULL` — só um afeta linha           |
| Transferências simultâneas              | `UPDATE … WHERE version = ?` (bloqueio otimista)                        |
| Webhook processado duas vezes           | Índice único em `(provider, external_event_id)`                         |
| Mensagem duplicada                      | Índice único parcial em `messages.whatsapp_message_id`                  |
| Status chegando fora de ordem           | Ranking de status: `sent → delivered → read` nunca retrocede            |

---

## Banco de dados

29 tabelas, todas as organizacionais com `organization_id`. Destaques:

- `organizations`, `users`, `sessions`, `teams`, `team_members`, `invitations`
- `whatsapp_connections` — número da empresa, número por setor, número
  individual do vendedor e **ramais**
- `contacts`, `contact_consents`, `conversations`, `messages`
- `tags`, `conversation_tags`, `quick_replies`
- `scheduled_followups`, `calendar_events` — agenda e retornos
- `kanban_boards`, `kanban_columns`, `kanban_cards` — quadros ilimitados por usuário
- `assignment_rules`, `assignment_cursors`, `notifications`
- `conversation_events`, `audit_logs`, `integration_events`, `conversation_viewers`

Migrações em `drizzle/`. Para alterar o esquema: edite `src/db/schema.ts`,
rode `npm run db:generate` e depois `npm run db:migrate`.

---

## Integração com o WhatsApp

Somente a **WhatsApp Business Platform (Cloud API)** e a **Evolution API**.
Nada de automação de WhatsApp Web.

### Os três adaptadores

| Provedor    | Quando usar                                  | Credenciais            |
| ----------- | -------------------------------------------- | ---------------------- |
| `mock`      | Demonstração, desenvolvimento e testes       | nenhuma                |
| `cloud_api` | Produção com a API oficial da Meta           | token + phone_number_id|
| `evolution` | Produção com Evolution auto-hospedada        | URL + instância + chave|

### Webhook

```
GET  /api/webhooks/whatsapp   verificação (hub.challenge)
POST /api/webhooks/whatsapp   eventos
```

Assinatura validada por HMAC-SHA256 (`X-Hub-Signature-256`) na Cloud API e por
token de cabeçalho na Evolution. O endpoint responde rápido: valida, registra o
evento e processa — sem trabalho pesado antes da resposta. Falhas ficam em
`integration_events` com `next_retry_at` e backoff progressivo, e podem ser
reprocessadas pelo administrador em *Configurações › Integridade e logs*.

### Onde ficam os tokens

No banco vai apenas a **referência** ao segredo:

```
token_reference = "env:WHATSAPP_ACCESS_TOKEN"
```

O valor real vem de `process.env`, e só nomes com prefixo `WHATSAPP_` ou
`EVOLUTION_` são aceitos. A API de conexões nunca devolve o segredo — apenas
se a variável está presente no ambiente.

### Janela de atendimento

A janela livre de 24 horas é respeitada: fora dela a Cloud API exige mensagem
de modelo aprovado, e o sistema bloqueia o envio com mensagem clara em vez de
deixar a chamada falhar na Meta.

---

## Segurança

**Autenticação.** Senhas com scrypt (`N=16384, r=8, p=1`). O cookie guarda um
token aleatório de 32 bytes; o banco guarda só o SHA-256 dele. Sessão rotaciona
a cada login, expira, pode ser revogada, e troca de senha derruba todas as
sessões abertas. Bloqueio temporário após 5 tentativas.

**Isolamento multiempresa.** Duas camadas independentes: a camada de serviço
escopa toda consulta pelo `organization_id` do `AuthContext`, e
`drizzle/policies.sql` traz as políticas de RLS para aplicar no Postgres. O
cenário 13 dos testes verifica que um usuário não alcança dados de outra
empresa.

**Permissões.** `src/lib/auth/rbac.ts` é a fonte única: 25 permissões
distribuídas entre administrador, supervisor e vendedor.

**Rate limiting.** Login, recuperação de senha, envio, upload, pesquisa,
exportação, importação, convites, IA e webhooks.

**Proteção de dados.** `sanitizeMetadata` remove token, senha e segredo antes
de qualquer gravação em log. Mensagens de erro nunca trazem payload cru.
Telefone pode ser mascarado para vendedores. Contexto enviado à IA passa por
`redact()`, que mascara CPF, CNPJ, e-mail e telefone.

**Monitoramento.** O Sentry é opcional e desligado por padrão. Quando
`SENTRY_DSN` está configurado, os eventos passam por `limparEvento`
(`src/lib/observability.ts`) antes de sair: cookies e cabeçalhos de
autenticação são removidos, o corpo das rotas sensíveis é descartado, chaves
com telefone/token/conteúdo de mensagem viram `[oculto]`, e o usuário é
identificado só por id e perfil — sem nome, e-mail ou IP. Não há Session
Replay: gravar a tela de uma central de atendimento capturaria conversa de
cliente. Erros previsíveis (validação, permissão, sessão expirada) não são
reportados.

**Auditoria.** Login, logout, cadastro e desativação de usuários,
transferências, encerramentos, exportações e alterações de integração — com IP
e navegador.

---

## Testes

```bash
npm test
```

**107 testes, cinco arquivos.** Os de integração rodam contra um Postgres real
(PGlite), sem mock de banco.

- `tests/unitarios.test.ts` — distribuição, permissões, transições de status,
  respostas rápidas, horário de funcionamento, telefone, sanitização de logs,
  janela de atendimento e privacidade da IA.
- `tests/fluxos.test.ts` — os **13 cenários obrigatórios** do escopo, na ordem,
  mais idempotência, eventos fora de ordem e bloqueio de contato.
- `tests/permissoes.test.ts` — escopo por perfil, isolamento entre empresas,
  distribuição aplicada ao banco, mascaramento, kanban, métricas e auditoria.
- `tests/email.test.ts` — adaptadores, modelos e escape de HTML.
- `tests/observabilidade.test.ts` — a limpeza que impede dado de cliente de
  sair junto com um relatório de erro.

Três bugs reais foram encontrados por essa suíte durante o desenvolvimento e
corrigidos: `ON CONFLICT` sobre índice parcial sem repetir o predicado (que
quebrava a idempotência dos webhooks em Postgres), comparação de texto
arbitrário com coluna `uuid` (que abortava a busca de conexão), e supervisores
sem enxergar as conversas dos próprios vendedores.

---

## Deploy

Comece por [`docs/colocar-no-ar.md`](docs/colocar-no-ar.md) — checklist
sequencial de oito passos, do banco vazio até a primeira mensagem de WhatsApp
chegando, com como conferir cada etapa antes de seguir.

Os detalhes de cada parte ficam em
[`docs/deploy-vercel.md`](docs/deploy-vercel.md) (variáveis de ambiente,
Evolution, Gmail, limitações do serverless) e
[`docs/setup-supabase.md`](docs/setup-supabase.md) (criação do banco pela
interface, sem linha de comando).

## Automação com n8n

[`docs/n8n/`](docs/n8n/) traz um fluxo porteiro pronto para importar, que
resolve o atrito entre a Evolution (uma URL de webhook por instância) e o n8n
(uma URL por fluxo): um único fluxo recebe tudo, repassa ao PRICALL e
distribui para o fluxo de cada departamento.

### Checklist genérico

1. Provisione um PostgreSQL (Supabase, RDS, Neon…).
2. Configure as variáveis do `.env.example`. Em produção são obrigatórios
   `DATABASE_URL` e `SESSION_SECRET` (mínimo 32 caracteres).
3. `npm run db:migrate`
4. `psql "$DATABASE_URL" -f drizzle/policies.sql` — ativa o RLS.
5. Publique (Vercel, Fly.io, Docker…) e habilite HTTPS.
6. Cadastre o webhook na Meta: `https://SEU_DOMINIO/api/webhooks/whatsapp`,
   usando o mesmo `WHATSAPP_VERIFY_TOKEN`.
7. Crie o primeiro administrador em `/criar-empresa` e siga o onboarding.
8. Agende as tarefas periódicas:
   `POST /api/jobs` a cada 5 minutos, com o cabeçalho
   `x-pricall-job-token: $JOB_TOKEN`.
9. Teste a conexão em *Configurações › Integração do WhatsApp*.

### Ambientes

Desenvolvimento, homologação e produção devem ter banco, credenciais, endpoint
de webhook e logs próprios. O `DATABASE_DRIVER=pglite` é recusado em produção
pela validação de ambiente.

### Aplicativo instalável

O PRICALL é um PWA: `manifest.webmanifest` + service worker que faz cache
apenas do casco estático. Conversas e mensagens **nunca** vêm de cache — dado
de atendimento desatualizado é pior que a ausência de dado.

---

## Estrutura do projeto

```
src/
├── app/
│   ├── (app)/              telas autenticadas (painel, atendimentos, equipe,
│   │                       relatórios, kanban, agenda, configurações)
│   ├── api/                53 route handlers
│   ├── entrar/ criar-empresa/ onboarding/ …
│   └── globals.css         tema, tokens e acessibilidade
├── components/
│   ├── ui/                 componentes base acessíveis
│   ├── app/                sessão, tempo real, navegação, notificações
│   └── inbox/              central de atendimento
├── db/                     esquema, cliente, migrações, seed
├── lib/                    auth, RBAC, distribuição, templates, telefone,
│                           horário, rate limit, auditoria, tempo real
├── modules/
│   ├── whatsapp/           provider + mock + cloud-api + evolution
│   └── ai/                 provider + mock + anthropic
└── server/
    ├── http.ts             respostas, validação, rate limit
    └── services/           regras de negócio
drizzle/                    migrações SQL + policies.sql (RLS)
tests/                      unitários, fluxos e permissões
```

---

## O que já está pronto

**Fase 1 — Base.** Autenticação completa (cadastro, login, recuperação,
convites, bloqueio por tentativas), organizações, três perfis, 29 tabelas,
layout responsivo com tema claro/escuro.

**Fase 2 — Central.** Caixa compartilhada com 10 filas e filtros por vendedor,
equipe, marcador, período e canal. Atribuição atômica, transferência,
encerramento com resultado, reabertura automática, presença ("outro vendedor
está digitando"), tempo real por SSE, carregamento progressivo e skeletons.

**Fase 3 — WhatsApp.** Adaptador mock com simulador, Cloud API oficial,
Evolution API, webhook idempotente, serviço de envio com reenvio sem perder o
texto, tela de conexões (empresa, setor, vendedor, ramais) e painel de
integridade com reprocessamento de eventos.

**Fase 4 — Gestão.** Equipes e setores, cinco estratégias de distribuição com
regra de reserva, respostas rápidas com variáveis e pré-visualização,
marcadores personalizáveis, retornos programados, agenda/calendário, kanban
ilimitado por usuário, relatórios com exportação e importação em CSV.

**Fase 5 — Qualidade.** IA assistiva (sugestão, resumo, classificação — sempre
com revisão humana), auditoria, painel de saúde, acessibilidade (navegação por
teclado, foco visível, ARIA, contraste, movimento reduzido, escala de fonte),
performance (paginação por cursor, debounce, índices, deltas em tempo real) e
86 testes.

### Fora do escopo desta versão

Estoque, pagamentos, emissão fiscal e logística — como o escopo determinou.
A arquitetura em módulos comporta esses domínios sem reescrita.

### Pontos que exigem configuração antes de produção

- **Armazenamento de mídia.** O envio de anexos está validado (tipo, tamanho,
  MIME) e o recebimento é registrado, mas falta plugar um bucket com URL
  assinada para o upload pela interface.
- **MFA.** As colunas existem em `users`; o fluxo de ativação não foi
  implementado.
- **Rate limit em memória.** Suficiente para um processo. Em ambiente
  serverless com várias instâncias, o limite efetivo fica mais frouxo — troque
  o `store` de `src/lib/rate-limit.ts` por Redis mantendo a mesma assinatura.

---

## Aviso sobre o WhatsApp

PRICALL é um produto independente, sem afiliação com a Meta Platforms. Não
utiliza o logotipo, a identidade visual nem a interface do WhatsApp — a marca é
mencionada apenas para descrever a integração oficial.
