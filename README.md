# PontoView News Overlay · Newsroom Graphics

Sistema de gráficos para notícias, entrevistas, podcasts e web TVs. O projeto continua leve (HTML + JavaScript + GSAP), mas agora usa um modelo operacional de broadcast com **Preview / Program / TAKE** e Supabase como fonte única de verdade.

## Arquitetura

`Conta → Canal (workspace) → Programa → Sessão ao vivo`

- **Conta**: Supabase Auth.
- **Canal**: reutiliza `workspaces` para preservar compatibilidade.
- **Programa**: `programs`.
- **Sessão**: `live_sessions` com status `draft`, `ready`, `live` ou `ended`.
- **Preview / Program**: `session_state` armazena os dois estados em JSONB e uma revisão monotônica.
- **TAKE**: RPC transacional `take_session`, que copia Preview para Program e publica o novo Program via Supabase Realtime.
- **Notas**: `session_notes`, sincronizadas em tempo real entre desktop e mobile.
- **Presets**: a tabela existente `presets` foi mantida e recebeu `program_id`, `template_key` e `state`.

## Arquivos principais

| Arquivo | Função |
|---|---|
| `control.html` | Mesa de operação responsiva: Preview, Program, TAKE, templates, presets e notas |
| `studio.js` | Auth, Conta/Canal/Programa/Sessão, concorrência por revisão e Realtime |
| `studio.css` | Interface broadcast responsiva, incluindo modo mobile |
| `overlay.html` | Browser Source transparente para OBS |
| `overlay-runtime.js` | Renderização GSAP do Program e assinatura do canal público por token |
| `app-config.js` | URL, publishable key e estado padrão do produto |
| `access-gate.js` | Helper de assinatura compatível com o schema `subscriptions` atual |

## Supabase

Projeto: `pontoview-backend`

O frontend usa somente a **publishable key**. Nenhuma service role é exposta.

Migrations adicionadas:

- `20260820182213_newsroom_sessions_preview_program.sql`
- `20260820182300_newsroom_security_indexes.sql`

As tabelas expostas permanecem com RLS. Leituras públicas de `workspaces`, `overlays` e configurações foram removidas. O overlay recebe apenas o `program_state` por uma RPC estreita baseada em um `public_token` aleatório de sessão.

## Fluxo operacional

1. Entre no Studio.
2. Selecione ou crie um Canal.
3. Selecione ou crie um Programa.
4. Crie uma Sessão.
5. Edite o **Preview**. Alterações são salvas no Supabase, mas não vão ao ar.
6. Pressione **TAKE** para copiar Preview → Program atomicamente.
7. O overlay do OBS recebe o novo Program via Realtime.
8. Desktop e celular podem operar a mesma sessão usando o mesmo login.

## OBS Browser Source

A URL é gerada no painel com este formato:

```text
overlay.html?token=<PUBLIC_TOKEN_DA_SESSAO>
```

Configuração recomendada: **1920 × 1080**, fundo transparente.

O overlay não exige login e não possui permissão de escrita.

## Templates iniciais

- Lower Third
- Identificação / Entrevista
- Breaking News
- Manchete
- Ticker
- Logo / relógio

A composição permanece padronizada. O operador altera conteúdo, cores, fonte, logo, animação e visibilidade, sem um editor gráfico livre.

## Concorrência

`session_state.revision` implementa concorrência otimista. Se outro dispositivo alterar a sessão antes da gravação local, a operação falha com `STATE_CONFLICT` e o painel recarrega o estado canônico em vez de sobrescrever silenciosamente.

## Stack

- HTML + CSS + JavaScript
- Supabase JS `2.112.3`
- Supabase Auth, PostgreSQL, RLS e Realtime
- GSAP `3.12.7`
- OBS Browser Source
