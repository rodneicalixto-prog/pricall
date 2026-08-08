# n8n + Evolution + PRICALL

Como encaixar fluxos do n8n numa central com vários departamentos, sem que
cada um precise do próprio webhook na Evolution.

O arquivo [`porteiro-whatsapp.json`](./porteiro-whatsapp.json) é um fluxo
pronto para importar.

---

> **Antes de tudo: você já tem fluxos rodando?**
>
> O porteiro serve para instâncias **novas**. Se já existem fluxos ativos com
> webhook próprio na Evolution, apontar tudo para ele **derruba o que
> funciona**. Vá direto para
> [Quando já existem fluxos em produção](#quando-já-existem-fluxos-em-produção).

## O atrito

A Evolution aceita **uma URL de webhook por instância**. O n8n cria **uma URL
por fluxo**. Com um departamento isso não incomoda; com cinco, não fecha.

A saída é um fluxo porteiro: ele é o único cadastrado na Evolution e distribui
para os demais por dentro.

```
Evolution (todas as instâncias)
   └─→ Porteiro WhatsApp          ← única URL cadastrada
         ├─→ PRICALL              ← sempre, em paralelo
         └─→ Switch por instância
               ├─→ Fluxo Vendas
               ├─→ Fluxo Suporte
               └─→ Fluxo Financeiro
```

Os fluxos de departamento são chamados por **Execute Workflow**. Continuam
sendo fluxos normais, editáveis e testáveis em separado — só não precisam mais
de webhook próprio.

---

## Instalar

**1.** No n8n: *Workflows › Import from File* → escolha `porteiro-whatsapp.json`

**2.** Crie a variável de ambiente do n8n com a URL do PRICALL já com o token:

```
PRICALL_WEBHOOK_URL=https://pricall.vercel.app/api/webhooks/whatsapp?token=SEU_TOKEN
```

O token é o mesmo `EVOLUTION_WEBHOOK_TOKEN` cadastrado no Vercel. Guardá-lo
como variável evita que ele viaje junto do JSON quando o fluxo for exportado
ou versionado.

Se o seu n8n bloqueia `$env` nos nós, troque a expressão do nó **Repassar ao
PRICALL** pela URL completa — mas então não exporte esse fluxo para lugar
nenhum.

**3.** Ative o fluxo e copie a **Production URL** do nó `Evolution`.

**4.** Cadastre essa URL na Evolution, em **cada instância**:

| Campo | Valor |
| ----- | ----- |
| Enabled | ligado |
| URL | a Production URL do porteiro |
| Webhook by Events | **desligado** |
| Events | `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `SEND_MESSAGE` |

A mesma URL em todas. O campo `instance` no corpo é o que separa os
departamentos.

**5.** No nó **Qual departamento**, ajuste os nomes das instâncias e ligue cada
saída ao Execute Workflow correspondente.

---

## Quando já existem fluxos em produção

Cada fluxo com webhook próprio cadastrado na Evolution continua funcionando
como está. Trocar a URL dele pela do porteiro é migração — e migração de algo
que funciona, num sistema que atende cliente, não se faz sem necessidade.

O caminho de menor risco é **acrescentar um ramo** ao que já existe:

```
Recebe Evolution
   ├─→ [novo] Repassar ao PRICALL      ← HTTP Request
   └─→ Filtra e Extrai                  ← o fluxo original, sem alteração
```

O nó novo:

| Campo | Valor |
| ----- | ----- |
| Método | `POST` |
| URL | `{{ $env.PRICALL_WEBHOOK_URL }}` |
| Body | `{{ JSON.stringify($json.body) }}` |
| On Error | **Continue** |
| Timeout | 15000 |

Sai em paralelo, tolerante a erro. Se o PRICALL cair, o fluxo nem percebe. Se o
fluxo quebrar, o PRICALL já recebeu. Nenhuma linha do que existe é tocada.

O porteiro fica para os números novos, que nascem já com a estrutura certa.

### Antes de mexer nos fluxos antigos

Vale uma conferida no que já está lá. Encontrei, num deles, a apikey da
Evolution escrita **direto como valor de header no node**, em vez de
credencial. Quem exportar o workflow leva a chave junto.

Se for tocar nesses fluxos de qualquer forma, é uma boa hora para mover as
chaves para credenciais.

---

## Acrescentar um departamento

1. Crie a instância na Evolution e pareie o número
2. Cadastre o número no PRICALL (Configurações › Integração do WhatsApp)
3. Aponte o webhook da instância nova para o mesmo porteiro
4. No Switch, duplique uma regra e troque o nome da instância
5. Ligue a saída nova a um Execute Workflow

Nenhum passo exige mexer em Vercel, Supabase ou variáveis de ambiente.

---

## Três coisas que mordem

### Não altere `data.key.id`

É por ele que o PRICALL descarta duplicata. Se o n8n reenviar o mesmo evento —
por retry, por erro, por reprocessamento — o PRICALL ignora em vez de criar
mensagem repetida. Mudar o id quebra essa proteção.

### Verifique `fromMe` antes de processar

Quando um fluxo responde pela Evolution, a resposta volta como webhook com
`fromMe: true`. Sem essa verificação o fluxo reage à própria resposta, e
responde de novo — laço infinito, com o cliente recebendo tudo.

O porteiro já traz essa trava. Mantenha-a nos fluxos que você escrever direto.

Repare que o repasse ao PRICALL acontece **mesmo** para `fromMe`: é desejável
que a central mostre o que o bot respondeu, junto do resto da conversa.

### O repasse vem antes do processamento

No porteiro, PRICALL e Switch saem do mesmo nó, em paralelo, e o repasse está
marcado para continuar mesmo em erro.

Se o PRICALL cair, os fluxos seguem rodando. Se um fluxo quebrar, o histórico
da central continua completo. Encadear os dois em série trocaria isso por uma
dependência que não precisa existir.

---

## Campos úteis do envelope

```
{{ $json.body.instance }}                  qual número recebeu
{{ $json.body.event }}                     messages.upsert, messages.update…
{{ $json.body.data.key.remoteJid }}        o cliente (5511999999999@s.whatsapp.net)
{{ $json.body.data.key.fromMe }}           saiu do nosso número
{{ $json.body.data.key.id }}               id da mensagem — não altere
{{ $json.body.data.pushName }}             nome do contato no WhatsApp
{{ $json.body.data.message.conversation }} texto simples
{{ $json.body.data.message.extendedTextMessage.text }}   texto com formatação ou resposta
```

O texto vem em `conversation` **ou** em `extendedTextMessage.text`, conforme a
mensagem tenha ou não formatação, link ou citação. Trate os dois:

```
{{ $json.body.data.message.conversation || $json.body.data.message.extendedTextMessage?.text || '' }}
```

---

## Quando o n8n precisar reagir ao PRICALL

O que está aqui cobre o sentido **WhatsApp → n8n → PRICALL**.

O contrário — o n8n reagir a algo que aconteceu dentro da central, como uma
conversa finalizada disparando pesquisa de satisfação — ainda não existe: o
PRICALL recebe webhook, mas não emite.

É implementável sobre o mesmo barramento de eventos que já alimenta o tempo
real. Abra uma conversa sobre isso se precisar.
