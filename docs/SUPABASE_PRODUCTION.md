# Supabase em produção

## Arquitetura ativa

O Supabase é a origem de dados e autenticação. Dados compartilhados da organização ficam em `workspace_states`; conversas pertencem ao vendedor em `user_simulations`; a recuperação idempotente das respostas de IA usa `simulation_generations`.

A migration `202611140001_saas_hardening.sql` torna a gravação do workspace e das conversas atômica, adiciona controle otimista de versão e impede gravações diretas que contornem a RPC.

## Variáveis obrigatórias

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`, somente no servidor
- `GEMINI_API_KEY`, somente no servidor
- `GEMINI_MODEL`
- `GEMINI_TIMEOUT_MS`
- `GEMINI_MAX_OUTPUT_TOKENS`, padrão `180`
- `GEMINI_THINKING_LEVEL`, padrão `minimal`
- `GEMINI_USER_RPM_LIMIT`, padrão `4`
- `GEMINI_USER_DAILY_REQUEST_LIMIT`, padrão `50`
- `GEMINI_USER_DAILY_TOKEN_LIMIT`, padrão `200000`

Nunca exponha a chave `service_role` com prefixo `NEXT_PUBLIC_`. Restrinja o acesso às variáveis de produção no provedor de deploy.

## Publicação das migrations

Antes de publicar, vincule a CLI ao projeto correto e revise o diff:

```bash
supabase db diff --linked
supabase db push --dry-run
supabase db push
```

Depois, execute os testes locais de banco a partir de um banco recriado:

```bash
supabase db reset
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database_tests.sql
```

## Checklist operacional

- Use projetos separados para desenvolvimento, homologação e produção.
- Ative backups automáticos no plano de produção e mantenha dumps externos periódicos.
- Teste a restauração, não apenas a criação do backup.
- Revise usuários com acesso ao dashboard e habilite MFA.
- Configure URLs de autenticação separadas por ambiente.
- Monitore erros das rotas `/api/simulate` e `/api/team-members`.
- Revise o painel **Consumo do Gemini** e ajuste os limites por ambiente, sem alterar o código.
- Nunca edite migrations já aplicadas; crie uma nova migration aditiva.
- Teste isolamento entre duas organizações antes de cada release que altere RLS.

## Concorrência

Cada carregamento lê `workspace_states.version`. A RPC `save_workspace_and_simulations` bloqueia a linha e só grava quando a versão esperada ainda é atual. Em caso de conflito, a interface pede recarregamento em vez de sobrescrever silenciosamente dados de outro usuário.

## Criação de usuários

A criação de membros ocorre em `/api/team-members`. A rota valida o token, confirma que o solicitante é administrador, usa a chave de serviço somente no servidor e remove o usuário do Auth caso a criação do perfil falhe.
