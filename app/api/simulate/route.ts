import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOptimizedSimulationInstruction,
  isNaturalReply,
  normalizeSimulationMessages,
  parseLeadReply,
  shouldDeclineEarlyMeeting,
  toOptimizedGeminiContents,
  type SimulationChatMessage,
  type SimulationLeadPayload,
} from "../../../lib/simulation-context";
import { migrateLocalData } from "../../../lib/local-domain";
import { buildGenerationSnapshot } from "../../../lib/simulation-snapshot";
import { createAdminSupabase, createAuthenticatedSupabase } from "../../../lib/supabase-server";

type SimulationRequest = {
  conversationId?: string;
  batchId?: string;
  requestId?: string;
};

type ValidatedSimulationRequest = {
  conversationId: string;
  batchId: string;
  requestId: string;
};

type SimulationResult = {
  status: number;
  body: Record<string, unknown>;
};

type GeminiPayload = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  error?: {
    code?: number | string;
    message?: string;
    status?: string;
    details?: Array<{
      reason?: string;
      metadata?: Record<string, string>;
      violations?: Array<{ quotaMetric?: string; quotaId?: string }>;
      retryDelay?: string;
    }>;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
};

type GeminiAttempt = {
  ok: boolean;
  status: number;
  data: GeminiPayload | null;
  errorMessage: string;
  retryAfterSeconds?: number;
  durationMs: number;
  timedOut?: boolean;
};

type ProviderAttemptMetric = {
  model: string;
  status: number;
  quotaReason: string | null;
  promptTokens: number;
  candidateTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  totalTokens: number;
  durationMs: number;
};

type UsageLimitRow = {
  allowed?: boolean;
  limit_reason?: string | null;
  retry_after_seconds?: number;
  requests_last_minute?: number;
  requests_today?: number;
  tokens_today?: number;
};

type GenerationRow = { claimed?: boolean; generation_status?: "processing" | "completed" | "failed"; generation_request_id?: string; response_text?: string | null; error_message?: string | null };
type AuthenticatedRequest = { client: SupabaseClient; userId: string; organizationId: string };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

const temporaryFailureStatus = new Set([500, 502, 503, 504]);
const defaultGeminiTimeoutMs = 30_000;
const maxRequestBodyBytes = 16_384;
const generationCache = new Map<string, Promise<SimulationResult>>();

function simulationResult(body: Record<string, unknown>, status = 200): SimulationResult {
  return { status, body };
}

function technicalResult(message: string, status = 503, retryable = true, extra: Record<string, unknown> = {}): SimulationResult {
  return simulationResult({ error: message, technical: true, retryable, ...extra }, status);
}

function toResponse(result: SimulationResult) {
  return Response.json(result.body, { status: result.status });
}

function generationKey(userId: string, body: SimulationRequest) {
  if (!body.conversationId || !body.batchId) return "";
  return [userId, body.conversationId, body.batchId].join(":");
}

function isValidIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9:_-]+$/.test(value);
}

function hasValidIdentifiers(body: unknown): body is ValidatedSimulationRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const candidate = body as SimulationRequest;
  return isValidIdentifier(candidate.conversationId) && isValidIdentifier(candidate.batchId) && isValidIdentifier(candidate.requestId);
}

function logDiagnostic(event: string, details: Record<string, unknown>) {
  console.info(`[simulaLEAD] ${event}`, details);
}

function configuredGeminiTimeoutMs() {
  const configured = Number(process.env.GEMINI_TIMEOUT_MS || "");
  return Number.isFinite(configured) && configured >= 5_000 ? configured : defaultGeminiTimeoutMs;
}

function configuredGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
}

function configuredPositiveInteger(name: string, fallback: number, maximum: number) {
  const configured = Number(process.env[name] || "");
  return Number.isInteger(configured) && configured > 0 && configured <= maximum ? configured : fallback;
}

function configuredThinkingLevel() {
  const configured = process.env.GEMINI_THINKING_LEVEL?.trim().toLowerCase();
  return configured && ["minimal", "low", "medium", "high"].includes(configured) ? configured : "minimal";
}

function parseRetryAfterSeconds(headerValue: string | null, message = "") {
  if (headerValue) {
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const dateValue = new Date(headerValue).getTime();
    if (!Number.isNaN(dateValue)) return Math.max(0, Math.ceil((dateValue - Date.now()) / 1000));
  }
  const match = message.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  return match ? Math.ceil(Number(match[1])) : undefined;
}

function shortProviderMessage(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 700);
}

function providerAttemptMetric(model: string, attempt: GeminiAttempt, finishReason = ""): ProviderAttemptMetric {
  const usage = attempt.data?.usageMetadata;
  const message = attempt.errorMessage.toLowerCase();
  const violation = attempt.data?.error?.details?.flatMap((detail) => detail.violations || [])[0];
  const detailReason = attempt.data?.error?.details?.map((detail) => detail.reason).find(Boolean);
  let quotaReason: string | null = detailReason || violation?.quotaId || violation?.quotaMetric || null;
  if (!quotaReason && attempt.status === 429) {
    quotaReason = /daily|per day|day/i.test(message)
      ? "DAILY_QUOTA"
      : /token/i.test(message)
        ? "TOKEN_QUOTA"
        : /billing|balance|credit/i.test(message)
          ? "BILLING_OR_BALANCE"
          : "RATE_OR_QUOTA_EXHAUSTED";
  }
  if (!quotaReason && finishReason === "MAX_TOKENS") quotaReason = "OUTPUT_MAX_TOKENS";
  return {
    model,
    status: attempt.status,
    quotaReason,
    promptTokens: Number(usage?.promptTokenCount || 0),
    candidateTokens: Number(usage?.candidatesTokenCount || 0),
    thoughtTokens: Number(usage?.thoughtsTokenCount || 0),
    cachedTokens: Number(usage?.cachedContentTokenCount || 0),
    totalTokens: Number(usage?.totalTokenCount || 0),
    durationMs: attempt.durationMs,
  };
}

function isDailyOrBillingQuota(reason: string | null, message: string) {
  return /daily|per.?day|requestsperday|quota_exceeded|billing|balance|credit/i.test(`${reason || ""} ${message}`);
}

function userFacingGeminiError(status: number, providerMessage: string, model: string, retryAfterSeconds?: number, quotaReason: string | null = null) {
  const message = providerMessage.toLowerCase();
  if (status === 401 || status === 403) {
    return technicalResult("A chave do Gemini foi recusada. Verifique GEMINI_API_KEY e permissoes do projeto.", status, false, { providerStatus: status, model });
  }
  if (status === 400 || status === 404) {
    return technicalResult(`O Gemini recusou a configuracao da simulacao para o modelo ${model}. Verifique GEMINI_MODEL e o payload enviado.`, 502, false, { providerStatus: status, model });
  }
  if (status === 429) {
    const wait = retryAfterSeconds ? ` Tente novamente em cerca de ${retryAfterSeconds}s.` : " Tente novamente mais tarde.";
    const dailyOrBilling = isDailyOrBillingQuota(quotaReason, providerMessage);
    return technicalResult(`Limite de uso do Gemini atingido.${wait}`, 429, !dailyOrBilling, {
      providerStatus: status,
      providerReason: dailyOrBilling ? "DAILY_OR_BILLING_QUOTA" : "RATE_LIMITED",
      quotaReason,
      retryAfterSeconds,
      model,
    });
  }
  if (/blocked|safety|prohibited|policy/i.test(message)) {
    return technicalResult("O Gemini bloqueou a resposta para esta conversa. Ajuste a mensagem e tente novamente.", 422, false, { providerStatus: status, model });
  }
  if (/MAX_TOKENS/i.test(providerMessage)) {
    return technicalResult("O Gemini interrompeu a resposta por limite de tokens. Tente novamente para gerar uma resposta completa.", 502, true, { providerStatus: status, model });
  }
  return technicalResult("Nao foi possivel gerar a resposta do lead agora. Tente novamente.", temporaryFailureStatus.has(status) ? 503 : 502, true, { providerStatus: status, model });
}

async function callGemini(model: string, apiKey: string, body: string, timeoutMs: number): Promise<GeminiAttempt> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body,
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: GeminiPayload | null = null;
    try {
      data = raw ? JSON.parse(raw) as GeminiPayload : null;
    } catch {
      return {
        ok: false,
        status: response.status || 502,
        data: null,
        errorMessage: raw ? `Resposta nao JSON do Gemini: ${raw.slice(0, 200)}` : "Resposta vazia do Gemini.",
        durationMs: Date.now() - startedAt,
      };
    }
    const errorMessage = data?.error?.message || "";
    const detailRetryDelay = data?.error?.details?.map((detail) => detail.retryDelay).find(Boolean);
    const detailRetrySeconds = detailRetryDelay?.match(/^([0-9]+(?:\.[0-9]+)?)s$/)?.[1];
    return {
      ok: response.ok,
      status: response.status,
      data,
      errorMessage,
      retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after"), errorMessage) || (detailRetrySeconds ? Math.ceil(Number(detailRetrySeconds)) : undefined),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      data: null,
      errorMessage: timedOut ? `Timeout ao chamar Gemini apos ${timeoutMs}ms.` : error instanceof Error ? error.message : "Falha de rede ao chamar Gemini.",
      durationMs: Date.now() - startedAt,
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticate(request: Request): Promise<AuthenticatedRequest | SimulationResult> {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!accessToken) return technicalResult("Sua sessao expirou. Entre novamente para continuar.", 401, true);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) return technicalResult("O backend de persistencia nao esta configurado.", 503, true);

  const client = createAuthenticatedSupabase(accessToken);
  const { data: authData, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !authData.user) return technicalResult("Sua sessao expirou. Entre novamente para continuar.", 401, true);
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("organization_id,is_active")
    .eq("id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (profileError) return technicalResult("Nao foi possivel validar seu acesso agora.", 503, true);
  if (!profile) return technicalResult("Seu usuario nao tem acesso a esta simulacao.", 403, false);
  return { client, userId: authData.user.id, organizationId: profile.organization_id as string };
}

function isSimulationResult(value: AuthenticatedRequest | SimulationResult): value is SimulationResult {
  return "status" in value && "body" in value;
}

async function loadPersistedSnapshot(auth: AuthenticatedRequest, conversationId: string, batchId: string) {
  const [{ data: workspace, error: workspaceError }, { data: simulation, error: simulationError }] = await Promise.all([
    auth.client.from("workspace_states").select("payload").eq("organization_id", auth.organizationId).maybeSingle(),
    auth.client
      .from("user_simulations")
      .select("payload")
      .eq("organization_id", auth.organizationId)
      .eq("seller_id", auth.userId)
      .eq("conversation_id", conversationId)
      .maybeSingle(),
  ]);
  if (workspaceError || simulationError) throw new Error(workspaceError?.message || simulationError?.message || "Falha ao carregar a simulacao.");
  if (!workspace || !simulation) return null;
  const data = migrateLocalData({
    ...(workspace.payload as Record<string, unknown>),
    conversations: [{ ...(simulation.payload as Record<string, unknown>), sellerId: auth.userId }],
  });
  return buildGenerationSnapshot(data, conversationId, batchId);
}

async function reconcilePersistedResponse(
  auth: AuthenticatedRequest,
  conversationId: string,
  batchId: string,
  batchResponse: NonNullable<ReturnType<typeof buildGenerationSnapshot>>["batchResponse"],
) {
  if (!batchResponse) return null;
  const { error } = await auth.client.rpc("reconcile_simulation_generation", {
    requested_conversation_id: conversationId,
    requested_batch_id: batchId,
  });
  if (error) throw new Error("A resposta existe, mas o estado da solicitacao nao pôde ser reconciliado.");
  return {
    status: "completed",
    text: batchResponse.text,
    ended: Boolean(batchResponse.endsSimulation),
    conversationId,
    batchId,
    requestId: batchResponse.requestId,
  };
}

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request);
    if (isSimulationResult(auth)) return toResponse(auth);
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId") || "";
    const batchId = url.searchParams.get("batchId") || "";
    if (!isValidIdentifier(conversationId) || !isValidIdentifier(batchId)) {
      return toResponse(technicalResult("Identificadores da simulacao invalidos.", 400, false));
    }
    const snapshot = await loadPersistedSnapshot(auth, conversationId, batchId);
    if (!snapshot) return toResponse(technicalResult("Esta simulacao nao existe ou nao pertence ao usuario atual.", 404, false));
    const persisted = await reconcilePersistedResponse(auth, conversationId, batchId, snapshot.batchResponse);
    if (persisted) return Response.json(persisted);
    const { data, error } = await auth.client
      .from("simulation_generations")
      .select("status,request_id,response_text,error_message,simulation_ended,updated_at")
      .eq("organization_id", auth.organizationId)
      .eq("seller_id", auth.userId)
      .eq("conversation_id", conversationId)
      .eq("batch_id", batchId)
      .maybeSingle();
    if (error) return toResponse(technicalResult("Nao foi possivel verificar a resposta do lead.", 503, true));
    if (!data) return Response.json({ status: "interrupted", retryable: true }, { status: 404 });
    if (data.status === "completed") return Response.json({ status: data.status, text: data.response_text, ended: Boolean(data.simulation_ended), conversationId, batchId, requestId: data.request_id });
    if (data.status === "failed") return Response.json({ status: data.status, error: data.error_message || "A geracao foi interrompida.", retryable: true, conversationId, batchId, requestId: data.request_id }, { status: 409 });
    return Response.json({ status: data.status, conversationId, batchId, requestId: data.request_id }, { status: 202 });
  } catch (error) {
    logDiagnostic("Erro ao verificar simulacao.", {
      error: error instanceof Error ? error.message : "Erro inesperado.",
    });
    return toResponse(technicalResult("Falha ao verificar a simulacao.", 503, true));
  }
}

export async function POST(request: Request) {
  let requestBody: ValidatedSimulationRequest | null = null;
  try {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
      return toResponse(technicalResult("Solicitacao muito grande.", 413, false));
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > maxRequestBodyBytes) {
      return toResponse(technicalResult("Solicitacao muito grande.", 413, false));
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return toResponse(technicalResult("Corpo da solicitacao invalido.", 400, false));
    }
    if (!hasValidIdentifiers(parsedBody)) {
      return toResponse(technicalResult("Identificadores da simulacao invalidos.", 400, false));
    }
    requestBody = parsedBody;
    const auth = await authenticate(request);
    if (isSimulationResult(auth)) return toResponse(auth);
    const snapshot = await loadPersistedSnapshot(auth, requestBody.conversationId, requestBody.batchId);
    if (!snapshot) return toResponse(technicalResult("Esta simulacao nao existe ou nao pertence ao usuario atual.", 404, false));
    const persisted = await reconcilePersistedResponse(auth, requestBody.conversationId, requestBody.batchId, snapshot.batchResponse);
    if (persisted) return Response.json(persisted);
    const messages = normalizeSimulationMessages(snapshot.messages);
    if (messages.length > 60) {
      return toResponse(technicalResult("Limite de mensagens atingido.", 400, false));
    }
    if (messages.length === 0 || messages.at(-1)?.from !== "seller") {
      return toResponse(technicalResult("O lote nao possui uma mensagem pendente do vendedor.", 409, false));
    }

    const lead = snapshot.lead;
    const cacheKey = generationKey(auth.userId, requestBody);
    const diagnostic = {
      userId: auth.userId,
      leadId: lead.id || "unknown",
      conversationId: requestBody.conversationId || "adhoc",
      batchId: requestBody.batchId || "none",
      requestId: requestBody.requestId || "none",
      messageCount: messages.length,
      order: messages.map((message, index) => ({
        index,
        id: message.id || null,
        from: message.from,
        createdAt: message.createdAt || null,
      })),
    };

    const { data: claimData, error: claimError } = await auth.client.rpc("claim_simulation_generation", {
      requested_conversation_id: requestBody.conversationId,
      requested_batch_id: requestBody.batchId,
      requested_request_id: requestBody.requestId,
    });
    if (claimError) return toResponse(technicalResult("Nao foi possivel registrar a geracao da resposta.", 503, true));
    const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as GenerationRow | null;
    if (!claim) return toResponse(technicalResult("Nao foi possivel registrar a geracao da resposta.", 503, true));
    if (claim.generation_status === "completed" && claim.response_text) {
      return Response.json({ text: claim.response_text, status: "completed", conversationId: requestBody.conversationId, batchId: requestBody.batchId, requestId: claim.generation_request_id });
    }
    if (!claim.claimed) {
      const cached = generationCache.get(cacheKey);
      if (cached) return toResponse(await cached);
      return Response.json({ status: "processing", conversationId: requestBody.conversationId, batchId: requestBody.batchId, requestId: claim.generation_request_id }, { status: 202 });
    }

    const promise = generateAndPersist(auth, requestBody, lead, messages, diagnostic);
    generationCache.set(cacheKey, promise);
    try {
      return toResponse(await promise);
    } finally {
      if (generationCache.get(cacheKey) === promise) generationCache.delete(cacheKey);
    }
  } catch (error) {
    logDiagnostic("Erro inesperado na simulacao.", {
      conversationId: requestBody?.conversationId || "unknown",
      batchId: requestBody?.batchId || "unknown",
      requestId: requestBody?.requestId || "unknown",
      error: error instanceof Error ? error.message : "Erro inesperado.",
    });
    return toResponse(technicalResult("Nao foi possivel processar a simulacao agora.", 500, true));
  }
}

async function generateAndPersist(
  auth: AuthenticatedRequest,
  requestBody: SimulationRequest & { conversationId?: string; batchId?: string; requestId?: string },
  lead: SimulationLeadPayload,
  messages: SimulationChatMessage[],
  diagnostic: Record<string, unknown>,
) {
  const conversationId = requestBody.conversationId!;
  const batchId = requestBody.batchId!;
  const requestId = requestBody.requestId!;
  const requiresProvider = Boolean(process.env.GEMINI_API_KEY) && !shouldDeclineEarlyMeeting(messages);
  const usageLimit = requiresProvider ? await checkUsageLimit(auth, configuredGeminiModel(), requestId) : null;
  const result = usageLimit || await generateSimulationResult(requestBody, lead, messages, diagnostic, async (metric) => {
    try {
      const { error } = await createAdminSupabase().rpc("record_simulation_generation_usage", {
        requested_seller_id: auth.userId,
        requested_conversation_id: conversationId,
        requested_batch_id: batchId,
        requested_request_id: requestId,
        requested_provider_model: metric.model,
        requested_provider_status: metric.status,
        requested_quota_reason: metric.quotaReason,
        requested_prompt_tokens: metric.promptTokens,
        requested_candidate_tokens: metric.candidateTokens,
        requested_thought_tokens: metric.thoughtTokens,
        requested_cached_tokens: metric.cachedTokens,
        requested_total_tokens: metric.totalTokens,
        requested_duration_ms: metric.durationMs,
      });
      if (error) logDiagnostic("Falha ao registrar consumo Gemini.", { ...diagnostic, providerStatus: metric.status });
    } catch {
      logDiagnostic("Metricas Gemini indisponiveis: service role ausente.", { ...diagnostic, providerStatus: metric.status });
    }
  });
  const text = typeof result.body.text === "string" ? result.body.text : "";
  if (result.status >= 200 && result.status < 300 && text) {
    const { error } = await auth.client.rpc("complete_simulation_generation", {
      requested_conversation_id: conversationId,
      requested_batch_id: batchId,
      requested_request_id: requestId,
      generated_text: text,
      requested_simulation_ended: Boolean(result.body.ended),
    });
    if (error) return technicalResult("A resposta foi gerada, mas nao foi possivel salva-la. Tente recuperar novamente.", 503, true);
    return simulationResult({ ...result.body, status: "completed" });
  }
  const failureMessage = typeof result.body.error === "string" ? result.body.error : "Falha tecnica ao gerar a resposta.";
  await auth.client.rpc("fail_simulation_generation", {
    requested_conversation_id: conversationId,
    requested_batch_id: batchId,
    requested_request_id: requestId,
    failure_message: failureMessage,
  });
  return result;
}

async function checkUsageLimit(auth: AuthenticatedRequest, model: string, requestId: string): Promise<SimulationResult | null> {
  const { data, error } = await auth.client.rpc("check_gemini_usage_limit", {
    requested_provider_model: model,
    requested_request_id: requestId,
    requested_rpm_limit: configuredPositiveInteger("GEMINI_USER_RPM_LIMIT", 4, 1000),
    requested_daily_request_limit: configuredPositiveInteger("GEMINI_USER_DAILY_REQUEST_LIMIT", 50, 1_000_000),
    requested_daily_token_limit: configuredPositiveInteger("GEMINI_USER_DAILY_TOKEN_LIMIT", 200_000, 10_000_000_000),
  });
  if (error) return technicalResult("Nao foi possivel validar o limite de uso do Gemini.", 503, true);
  const limit = (Array.isArray(data) ? data[0] : data) as UsageLimitRow | null;
  if (!limit || limit.allowed !== false) return null;
  const retryAfterSeconds = Number(limit.retry_after_seconds || 0);
  const daily = limit.limit_reason === "PROJECT_DAILY_QUOTA" || limit.limit_reason === "USER_DAILY_REQUEST_LIMIT" || limit.limit_reason === "USER_DAILY_TOKEN_LIMIT";
  const label = limit.limit_reason === "USER_RPM_LIMIT"
    ? "Limite de requisicoes por minuto atingido."
    : "Limite diario de uso atingido.";
  return technicalResult(`${label} Tente novamente em cerca de ${retryAfterSeconds}s.`, 429, !daily, {
    providerReason: limit.limit_reason,
    retryAfterSeconds,
    usage: {
      requestsLastMinute: Number(limit.requests_last_minute || 0),
      requestsToday: Number(limit.requests_today || 0),
      tokensToday: Number(limit.tokens_today || 0),
    },
    model,
  });
}

async function generateSimulationResult(
  requestBody: SimulationRequest,
  lead: SimulationLeadPayload,
  messages: SimulationChatMessage[],
  diagnostic: Record<string, unknown>,
  recordAttempt: (metric: ProviderAttemptMetric) => Promise<void>,
): Promise<SimulationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  logDiagnostic("Preparando simulacao Gemini.", diagnostic);

  if (!apiKey) {
    logDiagnostic("Gemini indisponivel: chave ausente.", diagnostic);
    return technicalResult("A API do Gemini nao esta configurada. Configure GEMINI_API_KEY e tente novamente.", 503, false);
  }

  if (shouldDeclineEarlyMeeting(messages)) {
    return simulationResult({
      text: "Antes de marcar, eu preciso entender melhor o motivo do contato. O que exatamente voce quer conversar comigo?",
      model: "conversation-policy",
      conversationId: requestBody.conversationId,
      batchId: requestBody.batchId,
      requestId: requestBody.requestId,
    });
  }

  const systemInstruction = buildOptimizedSimulationInstruction(lead, messages);
  const contents = toOptimizedGeminiContents(messages);
  const preferredModel = configuredGeminiModel();
  const timeoutMs = configuredGeminiTimeoutMs();
  const geminiBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature: lead.difficulty === "Difícil" || lead.difficulty === "DifÃ­cil" ? 0.8 : 0.7,
      maxOutputTokens: configuredPositiveInteger("GEMINI_MAX_OUTPUT_TOKENS", 180, 480),
      ...(preferredModel.startsWith("gemini-2.5")
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : preferredModel.startsWith("gemini-3")
          ? { thinkingConfig: { thinkingLevel: configuredThinkingLevel() } }
          : {}),
    },
  });
  let lastStatus = 502;
  let lastError = "";

  const model = preferredModel;
  let retryDelayMs = 1_200;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    const gemini = await callGemini(model, apiKey, geminiBody, timeoutMs);
    lastStatus = gemini.status;
    lastError = gemini.errorMessage || "";
    const finishReason = gemini.data?.candidates?.[0]?.finishReason || "";
    const metric = providerAttemptMetric(model, gemini, finishReason);
    await recordAttempt(metric);

    logDiagnostic("Tentativa Gemini concluida.", {
      ...diagnostic,
      model,
      attempt,
      providerStatus: gemini.status,
      durationMs: gemini.durationMs,
      timedOut: Boolean(gemini.timedOut),
      retryAfterSeconds: gemini.retryAfterSeconds || null,
      providerError: lastError ? shortProviderMessage(lastError) : "none",
    });

    if (gemini.ok) {
      const rawText = gemini.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
      const parsed = parseLeadReply(rawText || "");
      const text = parsed.text;
      if (text && isNaturalReply(text) && (!finishReason || finishReason === "STOP")) {
        logDiagnostic("Resposta Gemini gerada.", { ...diagnostic, model, attempt, finishReason: finishReason || "STOP" });
        return simulationResult({ text, ended: parsed.ended, model, conversationId: requestBody.conversationId, batchId: requestBody.batchId, requestId: requestBody.requestId });
      }
      lastError = finishReason === "MAX_TOKENS"
        ? "Gemini encerrou com finishReason MAX_TOKENS antes de uma resposta completa."
        : text
          ? "Gemini retornou texto fora dos criterios de naturalidade."
          : "Gemini retornou sem texto.";
      logDiagnostic("Resposta Gemini rejeitada por qualidade.", {
        ...diagnostic,
        model,
        attempt,
        finishReason: finishReason || "unknown",
        hasText: Boolean(text),
        rejectionReason: lastError,
      });
    }

    if ([400, 401, 403, 404].includes(gemini.status) || /billing|balance|credit/i.test(lastError)) {
      logDiagnostic("Falha Gemini nao reexecutada automaticamente.", {
        ...diagnostic,
        model,
        attempt,
        providerStatus: gemini.status,
        providerError: lastError ? shortProviderMessage(lastError) : "none",
      });
      return userFacingGeminiError(gemini.status, lastError, model, gemini.retryAfterSeconds, metric.quotaReason);
    }

    if (gemini.status === 429) {
      const dailyOrBilling = isDailyOrBillingQuota(metric.quotaReason, lastError);
      const waitSeconds = gemini.retryAfterSeconds;
      if (dailyOrBilling || attempt > 0 || !waitSeconds || waitSeconds > 20) {
        return userFacingGeminiError(gemini.status, lastError, model, gemini.retryAfterSeconds, metric.quotaReason);
      }
      retryDelayMs = Math.max(1_500, waitSeconds * 1_000);
      continue;
    }

    const temporaryFailure =
      temporaryFailureStatus.has(gemini.status) || /high demand|overloaded|temporar/i.test(lastError);
    if (!temporaryFailure) break;
    retryDelayMs = gemini.retryAfterSeconds ? gemini.retryAfterSeconds * 1_000 : Math.min(8_000, 1_200 * (2 ** attempt));
  }

  logDiagnostic("Falha ao gerar resposta Gemini.", { ...diagnostic, lastStatus, lastError: lastError ? shortProviderMessage(lastError) : "none" });
  return userFacingGeminiError(lastStatus, lastError, preferredModel);
}
