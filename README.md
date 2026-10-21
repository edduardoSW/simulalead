# simulaLEAD

Plataforma de treinamento comercial com simulações por IA, autenticação e persistência no Supabase.

## Desenvolvimento local

Requer Node.js 22 ou mais recente.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Preencha `.env.local` com as credenciais do seu ambiente. Esse arquivo é ignorado pelo Git.

## Variáveis de ambiente

| Variável | Visibilidade | Finalidade |
| --- | --- | --- |
| `GEMINI_API_KEY` | Somente servidor | Chave da API Gemini. Nunca use prefixo `NEXT_PUBLIC_`. |
| `GEMINI_MODEL` | Somente servidor | Modelo usado nas simulações. O padrão é `gemini-3.8-flash`. |
| `GEMINI_TIMEOUT_MS` | Somente servidor | Timeout por tentativa, em milissegundos. |
| `NEXT_PUBLIC_SUPABASE_URL` | Pública | URL do projeto Supabase. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Pública | Chave publicável do Supabase. Não use a `service_role`. |

## Deploy na Vercel

1. Importe `edduardoSW/simulalead` no painel da Vercel.
2. Mantenha o diretório raiz como `./` e o preset como **Next.js**.
3. Cadastre as cinco variáveis acima em **Settings > Environment Variables**.
4. No Supabase, adicione o domínio da Vercel em **Authentication > URL Configuration**, incluindo a URL de produção e os previews que desejar autorizar.
5. Execute o primeiro deploy.

Não configure `GEMINI_API_KEY` como variável pública. A rota `/api/simulate` valida o token do Supabase no servidor antes de chamar o Gemini.

## Verificação

```bash
npm run check
```

O comando executa lint, testes automatizados e o build de produção do Next.js.
