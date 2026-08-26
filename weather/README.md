# PontoView Weather Overlay · v1

Widget meteorológico independente para ser usado como uma segunda Browser Source sobre o PontoView News.

## O que está incluído

- Mesmo fluxo operacional do News: `Conta → Canal → Programa → Sessão`.
- Preview e Program independentes, com `TAKE` transacional usando o backend já existente.
- `PVW ON / PVW OFF` para preparar a visibilidade sem colocar no ar.
- `ON AIR / OFF AIR` para comandos rápidos.
- Até 5 cidades por sessão.
- Busca de cidades pela Open-Meteo Geocoding API.
- Dados atuais em lote pela Open-Meteo Forecast API.
- Temperatura atual, condição, mínima/máxima, umidade e vento.
- Atualização meteorológica automática a cada 10 minutos.
- Rotação automática entre cidades, com intervalo configurável.
- Troca interna por wipe: a moldura permanece e os dados da cidade são substituídos.
- 4 layouts: Compacto, Informativo, Completo e Multi-cidades.
- 4 posições: superior/inferior, esquerda/direita.
- Escala e cores configuráveis.
- Presets salvos na tabela `presets` já existente.
- URL pública de Browser Source baseada no `public_token` da sessão.
- Realtime com polling canônico de fallback, seguindo a estratégia do News.

## URLs

Controle:

```text
/weather/control.html
```

Browser Source:

```text
/weather/overlay.html?token=<PUBLIC_TOKEN_DA_SESSAO>
```

Configuração recomendada do Browser Source: **1920 × 1080**, fundo transparente.

## Backend

A versão 1 reaproveita a arquitetura genérica existente do PontoView News:

- `workspaces`, usando `product = weather_overlay`;
- `programs`;
- `live_sessions`;
- `session_state.preview_state` e `session_state.program_state` em JSONB;
- RPC `update_session_preview`;
- RPC `take_session`;
- RPC `set_session_status`;
- RPC pública somente leitura `get_overlay_state`.

Por isso, esta versão não exige nova tabela ou migration para funcionar. O estado Weather é identificado por `product: "weather_overlay"` dentro do JSONB.

## Open-Meteo

O protótipo usa os endpoints públicos da Open-Meteo diretamente porque não há segredo/API key a proteger. As coordenadas das cidades ficam no estado do overlay e uma única requisição pode consultar até as cinco cidades em lote.

Antes de disponibilizar o Weather comercialmente, trocar a camada de dados para o endpoint comercial/customer da Open-Meteo ou para um provider compatível com uso comercial. A UI e o estado foram mantidos desacoplados do provider para permitir essa troca sem redesenhar o overlay.

A atribuição `Dados: Open-Meteo` aparece discretamente junto ao widget.

## Estado Weather

```json
{
  "product": "weather_overlay",
  "template": "informative",
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
    "position": "top-left",
    "animation": "wipe",
    "scale": 1
  },
  "display": {
    "showCondition": true,
    "showMinMax": true,
    "showHumidity": false,
    "showWind": false,
    "showUpdated": false
  },
  "visibility": {
    "widget": true
  }
}
```

## Próximas evoluções naturais

- Cache/proxy meteorológico no Supabase para operação comercial em escala.
- Seleção manual de uma cidade específica no banco rápido.
- Presets de marca compartilhados por canal.
- Precipitação e sensação térmica como campos opcionais.
- Endpoint de saúde/provider para indicar dados desatualizados ao operador.
