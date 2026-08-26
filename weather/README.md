# PontoView Weather Overlay · v1

Overlay meteorológico independente para ser usado sobre o PontoView News ou qualquer composição de transmissão compatível com Browser Source.

## Comportamento

- Mesmo fluxo operacional do News: `Conta → Canal → Programa → Sessão`.
- Preview e Program independentes, com `TAKE` transacional.
- `PVW ON / PVW OFF` altera apenas o Preview.
- `ON AIR / OFF AIR` prepara a visibilidade e executa o TAKE.
- Cadastro de **1 a 5 cidades**.
- A cidade nunca é salva apenas pelo texto digitado: o operador pesquisa e escolhe um resultado com cidade, subdivisão administrativa, país, coordenadas e população quando disponível.
- Seleção manual da cidade que deve iniciar no Preview/TAKE.
- Modo **Carrossel**, mostrando uma cidade por vez.
- Modo **Painel**, mostrando até cinco cidades simultaneamente.
- No carrossel, rotação automática em 5, 8, 10, 15 ou 20 segundos.
- Na troca automática, a moldura permanece e apenas os dados fazem wipe.

## Presets de comportamento

- **Compacto**: cidade + temperatura.
- **Informativo**: cidade + temperatura + condição.
- **Completo**: cidade + temperatura + condição + mínima/máxima, com umidade e vento opcionais.
- **Multi-cidades**: modo painel, até cinco módulos simultâneos.

Cada módulo individual usa o mesmo footprint do **módulo lateral do PontoView News**:

```css
--module-w: clamp(178px, 12.4vw, 252px);
--module-h: clamp(84px, 10.8vh, 122px);
```

## Posicionamento

O widget pode usar nove âncoras:

- superior esquerda / centro / direita;
- centro esquerda / centro / direita;
- inferior esquerda / centro / direita.

Além da âncora, o operador dispõe de deslocamento horizontal e vertical para ajuste fino dentro do frame 1920×1080.

## Dados meteorológicos

O Browser Source **não consulta mais a Open-Meteo diretamente**.

Fluxo:

```text
Open-Meteo → Edge Function weather-api → weather_cache → Preview / Overlay
```

A Edge Function:

- faz a busca geográfica para usuários autenticados;
- valida o `public_token` quando a chamada vem do Browser Source;
- extrai as cidades diretamente do `program_state`, impedindo que um token público seja usado para consultar coordenadas arbitrárias;
- consulta a Open-Meteo em lote;
- grava o resultado em `weather_cache`;
- reutiliza o cache por 10 minutos;
- mantém o Browser Source desacoplado do fornecedor meteorológico.

A tabela `weather_cache` tem RLS ativado, não concede acesso a `anon` ou `authenticated` e é utilizada apenas pela função de backend com service role.

> Para prototipagem, a função aponta para os endpoints públicos da Open-Meteo. Antes da comercialização, o provider deve ser direcionado ao endpoint comercial/customer ou a outro fornecedor compatível com uso comercial.

A atribuição `Dados: Open-Meteo` permanece discretamente junto ao widget.

## URLs

Controle:

```text
/weather/control.html
```

Browser Source:

```text
/weather/overlay.html?token=<PUBLIC_TOKEN_DA_SESSAO>
```

Configuração recomendada: **1920 × 1080**, fundo transparente.

## Estado Weather

```json
{
  "product": "weather_overlay",
  "template": "informative",
  "mode": "carousel",
  "locations": [],
  "rotation": {
    "enabled": true,
    "interval": 8,
    "activeIndex": 0
  },
  "style": {
    "primary": "#003366",
    "secondary": "#ffffff",
    "surface": "#ffffff",
    "text": "#111827",
    "muted": "#667585",
    "font": "Inter",
    "position": "bottom-left",
    "offsetX": 0,
    "offsetY": 0,
    "animation": "wipe",
    "scale": 1
  },
  "display": {
    "showCondition": true,
    "showMinMax": true,
    "showHumidity": false,
    "showWind": false
  },
  "visibility": {
    "widget": true
  }
}
```

## Backend reaproveitado

O Weather continua usando a arquitetura genérica do Studio:

- `workspaces`, com `product = weather_overlay`;
- `programs`;
- `live_sessions`;
- `session_state.preview_state` e `session_state.program_state`;
- `update_session_preview`;
- `take_session`;
- `set_session_status`;
- `get_overlay_state`.

A novidade desta revisão é apenas a camada meteorológica centralizada: migration `weather_backend_cache` e Edge Function `weather-api`.
