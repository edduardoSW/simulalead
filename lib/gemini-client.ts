export type GeminiErrorDetail = {
  reason?: string;
  retryDelay?: string;
  metadata?: Record<string, string>;
  violations?: Array<{ quotaMetric?: string; quotaId?: string }>;
};

export type GeminiPayload = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: {
    code?: number | string;
    message?: string;
    status?: string;
    details?: GeminiErrorDetail[];
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
};

export type GeminiAttempt<TPayload extends GeminiPayload = GeminiPayload> = {
  ok: boolean;
  status: number;
  data: TPayload | null;
  errorMessage: string;
  retryAfterSeconds?: number;
  durationMs: number;
  timedOut?: boolean;
};

type GenerateGeminiContentOptions = {
  apiKey: string;
  model: string;
  body: unknown;
  timeoutMs: number;
};

export function isGeminiCredentialError(status: number, message: string) {
  return status === 401 || /api[_ ]?key[^.\n]*(not valid|invalid|revoked|expired)|invalid[^.\n]*api[_ ]?key|unauthenticated|invalid credential/i.test(message);
}

function parseRetryAfterSeconds(headerValue: string | null, message: string) {
  if (headerValue) {
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const dateValue = new Date(headerValue).getTime();
    if (!Number.isNaN(dateValue)) return Math.max(0, Math.ceil((dateValue - Date.now()) / 1_000));
  }
  const match = message.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  return match ? Math.ceil(Number(match[1])) : undefined;
}

export async function generateGeminiContent<TPayload extends GeminiPayload = GeminiPayload>({
  apiKey,
  model,
  body,
  timeoutMs,
}: GenerateGeminiContentOptions): Promise<GeminiAttempt<TPayload>> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: TPayload | null = null;
    try {
      data = raw ? JSON.parse(raw) as TPayload : null;
    } catch {
      // Provider payloads are never echoed because they may contain conversation content.
    }
    const errorMessage = data?.error?.message || (data ? "" : "Resposta inválida do Gemini.");
    const detailRetryDelay = data?.error?.details?.map((detail) => detail.retryDelay).find(Boolean);
    const detailRetrySeconds = detailRetryDelay?.match(/^([0-9]+(?:\.[0-9]+)?)s$/)?.[1];
    return {
      ok: response.ok,
      status: response.status,
      data,
      errorMessage,
      retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after"), errorMessage)
        || (detailRetrySeconds ? Math.ceil(Number(detailRetrySeconds)) : undefined),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      data: null,
      errorMessage: timedOut ? `Timeout ao chamar Gemini após ${timeoutMs}ms.` : "Falha de rede ao chamar Gemini.",
      durationMs: Date.now() - startedAt,
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
  }
}
