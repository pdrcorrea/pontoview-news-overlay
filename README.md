# 🎬 PontoView News Overlay — SaaS v2.0

> Sistema SaaS de overlay de notícias para transmissões ao vivo e mídia indoor. Controle pelo celular, em qualquer lugar, em tempo real via Supabase Realtime.

---

## 📦 Arquivos

| Arquivo | Função |
|---|---|
| `overlay.html` | Tela do overlay — adicionar no OBS como **Browser Source** com URL |
| `control.html` | Painel de controle — acessar do celular ou PC, de qualquer lugar |

---

## 🚀 Como usar

1. Abra o `control.html` hospedado (Cloudflare Pages, etc.)
2. Crie sua conta e seu **workspace** com um slug único
3. Copie a URL do overlay gerada (ex: `https://seusite.com/overlay.html?w=meu-slug`)
4. Cole no OBS como **Browser Source**
5. Controle o overlay do celular ou de qualquer PC em tempo real

---

## 🛠 Stack

- **Frontend:** HTML + JavaScript puro
- **Backend:** [Supabase](https://supabase.com) (Auth + PostgreSQL + Realtime)
- **Animações:** GSAP 3
- **Deploy sugerido:** Cloudflare Pages

---

## 🗄 Banco de Dados (Supabase)

```
workspaces     — um por cliente (slug único = URL do overlay)
overlay_state  — estado atual do overlay (sincronizado em tempo real)
presets        — manchetes salvas por workspace
```

---

## 💰 Planos sugeridos

| Plano | Preço | Recursos |
|---|---|---|
| Free | R$ 0 | 1 workspace, logo PontoView |
| Pro | R$ 49/mês | Logo customizada, 100 presets, suporte |
| Agency | R$ 149/mês | 5 workspaces, white-label |

---

`v2.0` — Maio 2026 · PontoView · Colatina, ES
