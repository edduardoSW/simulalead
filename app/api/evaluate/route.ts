import { buildEvaluationPrompt, evaluationResponseSchema, parseEvaluationResponse } from "../../../lib/gemini-evaluation";
import { migrateLocalData, type LocalEvaluation } from "../../../lib/local-domain";
import { createAdminSupabase, createAuthenticatedSupabase } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type EvaluationRequest = { conversationId?: string; requestId?: string };
type UsageLimitRow = { allowed?: boolean; limit_reason?: string | null; retry_after_seconds?: number };
type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; details?: Array<{ reason?: string; retryDelay?: string; violations?: Array<{ quotaId?: string; quotaMetric?: string }> }> };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number; totalTokenCount?: number };
};
type ProviderAttempt = { status: number; ok: boolean; data: GeminiPayload | null; error: string; retryAfterSeconds?: number; durationMs: number };
type EvaluationResult = { status: number; body: { evaluation?: LocalEvaluation; error?: string; retryAfterSeconds?: number } };

const evaluationsInFlight = new Map<string, Promise<EvaluationResult>>();
const maxRequestBytes = 4_096;

const configuredInteger = (name: string, fallback: number, maximum: number) => {
  const value = Number(process.env[name] || "");
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
};
const evaluationModel = () => process.env.GEMINI_EVALUATION_MODEL?.trim() || "gemini-2.5-flash";
const validId = (value: unknown): value is string => typeof value === "string" && value.length <= 160 && /^[A-Za-z0-9:_-]+$/.test(value);
const response = (result: EvaluationResult) => Response.json(result.body, { status: result.status });

function retryAfterSeconds(value: string | null, message = "") {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  }
  const match = message.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  return match ? Math.ceil(Number(match[1])) : undefined;
}

function quotaReason(attempt: ProviderAttempt) {
  const detail = attempt.data?.error?.details?.[0];
  const violation = detail?.violations?.[0];
  return detail?.reason || violation?.quotaId || violation?.quotaMetric || (attempt.status === 429 ? "RATE_OR_QUOTA_EXHAUSTED" : null);
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<ProviderAttempt> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const provider = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Voce e um avaliador de treinamento comercial B2B. Responda somente com o JSON solicitado, sem markdown." }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: configuredInteger("GEMINI_EVALUATION_MAX_OUTPUT_TOKENS", 900, 1_600),
          responseMimeType: "application/json",
          responseSchema: evaluationResponseSchema,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    const raw = await provider.text();
    let data: GeminiPayload | null = null;
    try { data = raw ? JSON.parse(raw) as GeminiPayload : null; } catch { /* handled below */ }
    const message = data?.error?.message || (data ? "" : "Resposta inválida do provedor.");
    const detailDelay = data?.error?.details?.map((detail) => detail.retryDelay).find(Boolean);
    return {
      status: provider.status,
      ok: provider.ok,
      data,
      error: message,
      retryAfterSeconds: retryAfterSeconds(provider.headers.get("retry-after"), message) || (detailDelay ? Math.ceil(Number(detailDelay.replace(/s$/, ""))) : undefined),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return { status: error instanceof DOMException && error.name === "AbortError" ? 504 : 502, ok: false, data: null, error: "Falha temporária ao avaliar.", durationMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

async function recordUsage(userId: string, conversationId: string, requestId: string, model: string, attempt: ProviderAttempt) {
  const usage = attempt.data?.usageMetadata;
  try {
    await createAdminSupabase().rpc("record_gemini_evaluation_usage", {
      requested_seller_id: userId,
      requested_conversation_id: conversationId,
      requested_request_id: requestId,
      requested_provider_model: model,
      requested_provider_status: attempt.status,
      requested_quota_reason: quotaReason(attempt),
      requested_prompt_tokens: Number(usage?.promptTokenCount || 0),
      requested_candidate_tokens: Number(usage?.candidatesTokenCount || 0),
      requested_thought_tokens: Number(usage?.thoughtsTokenCount || 0),
      requested_cached_tokens: Number(usage?.cachedContentTokenCount || 0),
      requested_total_tokens: Number(usage?.totalTokenCount || 0),
      requested_duration_ms: attempt.durationMs,
    });
  } catch { /* Evaluation remains available if monitoring is temporarily unavailable. */ }
}

async function evaluate(userId: string, organizationId: string, client: ReturnType<typeof createAuthenticatedSupabase>, conversationId: string, requestId: string): Promise<EvaluationResult> {
  const [{ data: simulation, error: simulationError }, { data: workspace, error: workspaceError }] = await Promise.all([
    client.from("user_simulations").select("payload").eq("organization_id", organizationId).eq("seller_id", userId).eq("conversation_id", conversationId).maybeSingle(),
    client.from("workspace_states").select("payload").eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (simulationError || workspaceError) return { status: 503, body: { error: "Não foi possível carregar a conversa para avaliação." } };
  if (!simulation || !workspace) return { status: 404, body: { error: "Conversa não encontrada." } };

  const workspacePayload = workspace.payload as Record<string, unknown>;
  const existing = Array.isArray(workspacePayload.evaluations)
    ? (workspacePayload.evaluations as LocalEvaluation[]).find((item) => item.conversationId === conversationId)
    : undefined;
  if (existing) return { status: 200, body: { evaluation: existing } };

  const data = migrateLocalData({ ...workspacePayload, conversations: [simulation.payload] });
  const conversation = data.conversations.find((item) => item.id === conversationId);
  if (!conversation) return { status: 404, body: { error: "Conversa não encontrada." } };
  if (conversation.status !== "completed") return { status: 409, body: { error: "Finalize a simulação antes de solicitar a avaliação." } };
  const account = data.accounts.find((item) => item.id === conversation.accountId);
  const opportunity = data.opportunities.find((item) => item.id === conversation.opportunityId);
  const product = data.products.find((item) => item.id === opportunity?.primaryProductId);
  const apiKey = process.env.GEMINI_EVALUATION_API_KEY;
  if (!apiKey) return { status: 503, body: { error: "A API de avaliação não está configurada." } };
  const model = evaluationModel();

  const { data: limitData, error: limitError } = await client.rpc("check_gemini_usage_limit", {
    requested_provider_model: model,
    requested_request_id: requestId,
    requested_rpm_limit: configuredInteger("GEMINI_EVALUATION_USER_RPM_LIMIT", 2, 100),
    requested_daily_request_limit: configuredInteger("GEMINI_EVALUATION_USER_DAILY_REQUEST_LIMIT", 20, 10_000),
    requested_daily_token_limit: configuredInteger("GEMINI_EVALUATION_USER_DAILY_TOKEN_LIMIT", 200_000, 100_000_000),
  });
  if (limitError) return { status: 503, body: { error: "Não foi possível validar o limite da avaliação." } };
  const limit = (Array.isArray(limitData) ? limitData[0] : limitData) as UsageLimitRow | null;
  if (limit?.allowed === false) return { status: 429, body: { error: "Limite de avaliações atingido. Tente novamente mais tarde.", retryAfterSeconds: Number(limit.retry_after_seconds || 0) } };

  const prompt = buildEvaluationPrompt(conversation, account, product);
  let attempt = await callGemini(apiKey, model, prompt);
  await recordUsage(userId, conversationId, requestId, model, attempt);
  const reason = quotaReason(attempt) || "";
  const dailyQuota = /daily|per.?day|requestsperday|quota_exceeded/i.test(`${reason} ${attempt.error}`);
  if (attempt.status === 429 && !dailyQuota && attempt.retryAfterSeconds && attempt.retryAfterSeconds <= 10) {
    await new Promise((resolve) => setTimeout(resolve, attempt.retryAfterSeconds! * 1_000));
    attempt = await callGemini(apiKey, model, prompt);
    await recordUsage(userId, conversationId, requestId, model, attempt);
  }
  if (!attempt.ok) {
    const finalReason = quotaReason(attempt) || "";
    const finalDailyQuota = /daily|per.?day|requestsperday|quota_exceeded/i.test(`${finalReason} ${attempt.error}`);
    if (attempt.status === 429) return { status: 429, body: { error: finalDailyQuota ? "Cota diária de avaliações esgotada." : "Limite temporário de avaliações atingido.", retryAfterSeconds: attempt.retryAfterSeconds } };
    if ([401, 403].includes(attempt.status)) return { status: 503, body: { error: "A chave da API de avaliação foi recusada." } };
    if (attempt.status === 404) return { status: 503, body: { error: `O modelo de avaliação ${model} não está disponível neste projeto.` } };
    return { status: 503, body: { error: "Não foi possível gerar a avaliação agora." } };
  }
  const raw = attempt.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  try {
    return { status: 200, body: { evaluation: parseEvaluationResponse(raw, conversationId, model) } };
  } catch {
    return { status: 502, body: { error: "A avaliação retornou em formato inválido. Tente novamente." } };
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > maxRequestBytes) return response({ status: 413, body: { error: "Solicitação muito grande." } });
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return response({ status: 401, body: { error: "Sua sessão expirou." } });
  let body: EvaluationRequest;
  try { body = await request.json() as EvaluationRequest; } catch { return response({ status: 400, body: { error: "Solicitação inválida." } }); }
  if (!validId(body.conversationId) || !validId(body.requestId)) return response({ status: 400, body: { error: "Identificadores inválidos." } });

  const client = createAuthenticatedSupabase(accessToken);
  const { data: authData, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !authData.user) return response({ status: 401, body: { error: "Sua sessão expirou." } });
  const { data: profile, error: profileError } = await client.from("profiles").select("organization_id,is_active").eq("id", authData.user.id).eq("is_active", true).maybeSingle();
  if (profileError) return response({ status: 503, body: { error: "Não foi possível validar seu acesso." } });
  if (!profile) return response({ status: 403, body: { error: "Usuário sem acesso à organização." } });

  const key = `${authData.user.id}:${body.conversationId}`;
  const running = evaluationsInFlight.get(key);
  if (running) return response(await running);
  const promise = evaluate(authData.user.id, profile.organization_id as string, client, body.conversationId, body.requestId);
  evaluationsInFlight.set(key, promise);
  try { return response(await promise); } finally { if (evaluationsInFlight.get(key) === promise) evaluationsInFlight.delete(key); }
}
