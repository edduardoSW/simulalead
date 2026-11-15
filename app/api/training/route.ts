import { generateGeminiContent, isGeminiCredentialError, type GeminiAttempt } from "../../../lib/gemini-client";
import {
  buildOptimizedSimulationInstruction,
  isNaturalReply,
  parseLeadReply,
  toOptimizedGeminiContents,
  type SimulationChatMessage,
  type SimulationLeadPayload,
} from "../../../lib/simulation-context";
import { createAdminSupabase, createAuthenticatedSupabase } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type TrainingRequest = {
  conversationId?: unknown;
  requestId?: unknown;
  lead?: unknown;
  messages?: unknown;
};
type UsageLimitRow = { allowed?: boolean; limit_reason?: string | null; retry_after_seconds?: number };
type TrainingResult = { status: number; body: Record<string, unknown> };

const requestsInFlight = new Map<string, Promise<TrainingResult>>();
const recentResults = new Map<string, { expiresAt: number; result: TrainingResult }>();
const maxRequestBytes = 262_144;

const response = (result: TrainingResult) => Response.json(result.body, { status: result.status });
const result = (status: number, body: Record<string, unknown>): TrainingResult => ({ status, body });
const validId = (value: unknown): value is string => typeof value === "string" && value.length <= 160 && /^[A-Za-z0-9:_-]+$/.test(value);
const configuredInteger = (name: string, fallback: number, maximum: number) => {
  const value = Number(process.env[name] || "");
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
};
const configuredModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const limitedText = (value: unknown, maximum = 700) => typeof value === "string" ? value.trim().slice(0, maximum) : "";

function parseLead(value: unknown): SimulationLeadPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const lead: SimulationLeadPayload = {};
  for (const field of ["name", "role", "company", "segment", "companySize", "problem", "solution", "communicationStyle", "visibleObjection", "secondaryObjection", "hiddenConcern", "decisionPower", "decisionBarrier", "difficulty"] as const) {
    const text = limitedText(source[field]);
    if (text) lead[field] = text;
  }
  return lead.name && lead.problem && lead.solution ? lead : null;
}

function parseMessages(value: unknown): SimulationChatMessage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 60) return null;
  const messages = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    const from = source.from === "seller" || source.from === "lead" ? source.from : null;
    const text = limitedText(source.text, 4_000);
    return from && text ? { id: `training-${index}`, from, text } : null;
  });
  return messages.every(Boolean) ? messages as SimulationChatMessage[] : null;
}

function quotaReason(attempt: GeminiAttempt) {
  const detail = attempt.data?.error?.details?.[0];
  const violation = detail?.violations?.[0];
  return detail?.reason || violation?.quotaId || violation?.quotaMetric || (attempt.status === 429 ? "RATE_OR_QUOTA_EXHAUSTED" : null);
}

async function recordUsage(userId: string, conversationId: string, requestId: string, model: string, attempt: GeminiAttempt) {
  const usage = attempt.data?.usageMetadata;
  try {
    await createAdminSupabase().rpc("record_independent_training_usage", {
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
  } catch { /* Training remains available if monitoring is temporarily unavailable. */ }
}

async function generate(userId: string, client: ReturnType<typeof createAuthenticatedSupabase>, conversationId: string, requestId: string, lead: SimulationLeadPayload, messages: SimulationChatMessage[]): Promise<TrainingResult> {
  const model = configuredModel();
  const { data: limitData, error: limitError } = await client.rpc("check_gemini_usage_limit", {
    requested_provider_model: model,
    requested_request_id: requestId,
    requested_rpm_limit: configuredInteger("GEMINI_USER_RPM_LIMIT", 4, 1_000),
    requested_daily_request_limit: configuredInteger("GEMINI_USER_DAILY_REQUEST_LIMIT", 50, 1_000_000),
    requested_daily_token_limit: configuredInteger("GEMINI_USER_DAILY_TOKEN_LIMIT", 200_000, 10_000_000_000),
  });
  if (limitError) return result(503, { error: "Não foi possível validar o limite do treinamento." });
  const limit = (Array.isArray(limitData) ? limitData[0] : limitData) as UsageLimitRow | null;
  if (limit?.allowed === false) return result(429, { error: "Limite de uso do Gemini atingido.", retryAfterSeconds: Number(limit.retry_after_seconds || 0) });

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return result(503, { error: "A API de simulação não está configurada." });
  const attempt = await generateGeminiContent({
    apiKey,
    model,
    timeoutMs: configuredInteger("GEMINI_TIMEOUT_MS", 30_000, 90_000),
    body: {
      systemInstruction: { parts: [{ text: buildOptimizedSimulationInstruction(lead, messages) }] },
      contents: toOptimizedGeminiContents(messages),
      generationConfig: {
        temperature: lead.difficulty === "Difícil" ? 0.8 : 0.7,
        maxOutputTokens: configuredInteger("GEMINI_MAX_OUTPUT_TOKENS", 180, 480),
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    },
  });
  await recordUsage(userId, conversationId, requestId, model, attempt);
  if (!attempt.ok) {
    if (isGeminiCredentialError(attempt.status, attempt.errorMessage)) return result(503, { error: `A chave da API de simulação foi recusada pelo Gemini (${attempt.status}).` });
    if (attempt.status === 403) return result(503, { error: "A chave da API de simulação não tem permissão para este projeto (403)." });
    if (attempt.status === 400 || attempt.status === 404) return result(502, { error: `O modelo de simulação ${model} não está disponível ou rejeitou a configuração (${attempt.status}).` });
    if (attempt.status === 429) return result(429, { error: "O limite temporário do Gemini foi atingido (429).", retryAfterSeconds: attempt.retryAfterSeconds });
    return result(attempt.status === 504 ? 504 : 503, { error: `O Gemini está temporariamente indisponível (${attempt.status}).` });
  }
  const raw = attempt.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  const reply = parseLeadReply(raw);
  if (!isNaturalReply(reply.text)) return result(502, { error: "O Gemini retornou uma resposta incompleta para o treinamento." });
  return result(200, { text: reply.text, ended: reply.ended, model, conversationId, requestId });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > maxRequestBytes) return response(result(413, { error: "Solicitação muito grande." }));
  const accessToken = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return response(result(401, { error: "Sua sessão expirou." }));
  let body: TrainingRequest;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxRequestBytes) return response(result(413, { error: "Solicitação muito grande." }));
    body = JSON.parse(raw) as TrainingRequest;
  } catch { return response(result(400, { error: "Solicitação inválida." })); }
  const lead = parseLead(body.lead);
  const messages = parseMessages(body.messages);
  if (!validId(body.conversationId) || !validId(body.requestId) || !lead || !messages || messages.at(-1)?.from !== "seller") {
    return response(result(400, { error: "Dados do treinamento inválidos." }));
  }

  const client = createAuthenticatedSupabase(accessToken);
  const { data: authData, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !authData.user) return response(result(401, { error: "Sua sessão expirou." }));
  const { data: profile, error: profileError } = await client.from("profiles").select("is_active").eq("id", authData.user.id).eq("is_active", true).maybeSingle();
  if (profileError) return response(result(503, { error: "Não foi possível validar seu acesso." }));
  if (!profile) return response(result(403, { error: "Usuário sem acesso ao treinamento." }));

  const key = `${authData.user.id}:${body.conversationId}:${body.requestId}`;
  const cached = recentResults.get(key);
  if (cached && cached.expiresAt > Date.now()) return response(cached.result);
  const running = requestsInFlight.get(key);
  if (running) return response(await running);
  const promise = generate(authData.user.id, client, body.conversationId, body.requestId, lead, messages);
  requestsInFlight.set(key, promise);
  try {
    const generated = await promise;
    recentResults.set(key, { expiresAt: Date.now() + 120_000, result: generated });
    return response(generated);
  } finally {
    if (requestsInFlight.get(key) === promise) requestsInFlight.delete(key);
    for (const [cacheKey, entry] of recentResults) if (entry.expiresAt <= Date.now()) recentResults.delete(cacheKey);
  }
}
