# 🎬 PontoView News Overlay

> Sistema de overlay de notícias para transmissões ao vivo e mídia indoor. Desenvolvido por [PontoView](https://github.com/pdrcorrea) — Tecnologia em Mídia Indoor · Colatina, ES.

---

## 📦 Arquivos

| Arquivo | Função |
|---|---|
| `overlay.html` | Tela do overlay — abrir no OBS como **Browser Source** |
| `control.html` | Painel de controle — abrir no navegador do operador |

---

## 🚀 Como usar

1. Abra o `control.html` em qualquer navegador moderno
2. Abra o `overlay.html` **na mesma origem** (mesmo navegador, outra aba) ou adicione ao OBS como Browser Source
3. O indicador no topo do painel ficará **verde** quando a conexão for detectada
4. Use os botões para controlar os elementos em tempo real

> ⚠️ **Importante:** O BroadcastChannel só funciona entre abas/janelas da **mesma origem**. Ambos os arquivos devem estar na mesma pasta e abertos pelo mesmo computador.

---

## 🎛️ Funcionalidades

- **ATUALIZAR GC** — envia manchete, tag, detalhe e ticker para o overlay
- **ATIVAR TUDO** — liga todos os elementos de uma vez
- **LIMPAR TELA** — oculta tudo com animação
- **Switches individuais** — controle por elemento (AO VIVO, LOGO/HORA, TAG, GC PRINCIPAL, TICKER)
- **Aba Estilo** — troca de cores de tema e logo em tempo real
- **Aba Memória** — presets salvos localmente, exportar/importar JSON
- **Resetar Configurações** — volta ao padrão de fábrica
- **Indicador de conexão** — mostra se o overlay está ativo

---

## ⚙️ Requisitos

- Navegador moderno com suporte a **BroadcastChannel API** (Chrome, Edge, Firefox)
- Conexão com internet para carregar GSAP (CDN) e fonte Inter (Google Fonts)
- Para uso offline: substituir CDN por arquivos locais (ver seção abaixo)

### Versão offline (opcional)
```
lib/
  gsap.min.js       ← baixar de https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js
fonts/
  inter.woff2       ← baixar de Google Fonts
```

---

## 🏷️ Versão

`v1.0` — Maio 2026
