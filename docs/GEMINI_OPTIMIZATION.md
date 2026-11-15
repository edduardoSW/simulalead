# Otimização do Gemini

## Objetivo

O fluxo mantém o histórico completo no Supabase, mas envia ao Gemini somente uma janela recente de até oito mensagens e uma memória extrativa dos fatos comerciais antigos. A memória é gerada localmente, sem consumir uma chamada adicional.

## Economia aplicada

- Prompt compacto sem JSON formatado e sem regras repetidas.
- Até oito mensagens recentes, em vez de até dezesseis.
- Mensagens limitadas a 1.000 caracteres no payload do provedor.
- Saída padrão limitada a 180 tokens, suficiente para 15–55 palavras.
- Raciocínio desativado nas chamadas Gemini 2.5 para evitar tokens de pensamento desnecessários.
- Resumo extrativo local para orçamento, prazo, decisão, reunião, objeções e compromissos.
- Idempotência por usuário, conversa e lote antes da chamada ao provedor.
- Reserva transacional de capacidade para impedir rajadas concorrentes do mesmo usuário.

O benchmark reproduzível pode ser executado com:

```bash
npm run benchmark:gemini
```

O cenário de 24 mensagens usado no benchmark reduziu o payload textual de 5.879 para 3.128 caracteres, uma redução aproximada de 47%. A redução real de tokens varia conforme o conteúdo e deve ser acompanhada pelas métricas retornadas pelo Gemini.

## Limites

Os limites são configurados por ambiente, portanto a migração futura para um plano pago não exige mudança de código:

- `GEMINI_USER_RPM_LIMIT=4`
- `GEMINI_USER_DAILY_REQUEST_LIMIT=50`
- `GEMINI_USER_DAILY_TOKEN_LIMIT=200000`
- `GEMINI_MAX_OUTPUT_TOKENS=180`
- `GEMINI_THINKING_LEVEL=minimal`

As simulações usam `GEMINI_API_KEY` e `GEMINI_MODEL=gemini-2.5-flash-lite`. A avaliação final usa exclusivamente `GEMINI_EVALUATION_API_KEY` e `GEMINI_EVALUATION_MODEL=gemini-2.5-flash`, com limites próprios de RPM, requisições diárias e tokens. A segunda chave não é usada como fallback para contornar cotas.

O limite diário segue a virada do dia no fuso `America/Los_Angeles`, alinhado ao reset de RPD informado pelo Gemini. Um 429 de minuto só é repetido uma vez quando o provedor informa `Retry-After` de até 20 segundos. Cota diária ou problema de faturamento não é repetido automaticamente.

## Monitoramento

Cada tentativa real ao provedor gera um evento em `gemini_usage_events`, incluindo:

- usuário, organização, conversa, lote, tipo da operação e modelo;
- status HTTP e motivo da cota;
- tokens de entrada, saída, raciocínio, cache e total;
- duração da chamada.

As views `gemini_usage_by_user` e `gemini_usage_by_simulation` usam `security_invoker` e RLS. Vendedores veem somente o próprio consumo; gestores e administradores veem a organização. O painel fica em **Configurações > Consumo do Gemini**.

## Segurança

As duas chaves Gemini permanecem somente nas rotas de servidor. `GEMINI_API_KEY` atende apenas simulações e `GEMINI_EVALUATION_API_KEY` apenas avaliações concluídas. A gravação de métricas aceita somente `service_role`; clientes autenticados consultam apenas dados liberados por RLS. Não existe rotação entre chaves para contornar limites.

O cache explícito não foi ativado: ele é um recurso cobrado e o contexto otimizado normalmente fica abaixo do mínimo útil para caching. Tokens atendidos pelo cache implícito continuam sendo registrados quando o provedor os informa.
