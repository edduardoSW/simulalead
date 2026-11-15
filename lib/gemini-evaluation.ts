import type { LocalAccount, LocalConversation, LocalEvaluation, LocalProduct } from "./local-domain";

export const evaluationCriteriaLabels = {
  communicationClarity: "Comunicação e clareza",
  needsIdentification: "Identificação das necessidades",
  questionQuality: "Qualidade das perguntas",
  objectionHandling: "Tratamento de objeções",
  commercialArgumentation: "Argumentação comercial",
  negotiationConduct: "Condução da negociação",
  closingAttempt: "Tentativa de fechamento",
} as const;

export const evaluationResponseSchema = {
  type: "object",
  properties: {
    criteria: {
      type: "object",
      properties: Object.fromEntries(Object.keys(evaluationCriteriaLabels).map((key) => [key, { type: "integer", minimum: 0, maximum: 10 }])),
      required: Object.keys(evaluationCriteriaLabels),
    },
    overallScore: { type: "number", minimum: 0, maximum: 10 },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
    improvements: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
    recommendations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
    nextStep: { type: "string" },
  },
  required: ["criteria", "overallScore", "summary", "strengths", "improvements", "recommendations", "nextStep"],
} as const;

export function buildEvaluationPrompt(conversation: LocalConversation, account?: LocalAccount, product?: LocalProduct) {
  const transcript = conversation.messages
    .filter((message) => message.sender !== "system")
    .slice(-60)
    .map((message) => `${message.sender === "seller" ? "VENDEDOR" : "CLIENTE"}: ${message.text.replace(/\s+/g, " ").trim().slice(0, 420)}`)
    .join("\n");
  return `Avalie esta simulacao de venda B2B em portugues do Brasil.
Contexto: empresa ${account?.name || "nao informada"}; segmento ${account?.segment || "nao informado"}; solucao relacionada ${product?.name || "nao informada"}.
Regras: avalie apenas comportamentos observaveis do vendedor; nao penalize ausencia de objecao, decisor, fechamento ou informacao que o cliente nao ofereceu; diferencie falha do vendedor de situacao fora do controle dele; use notas inteiras de 0 a 10 por criterio; seja direto, pratico e respeitoso; nao invente falas.
Conversa:
${transcript || "Sem mensagens comerciais."}`;
}

type RawEvaluation = {
  criteria?: Record<string, unknown>;
  overallScore?: unknown;
  summary?: unknown;
  strengths?: unknown;
  improvements?: unknown;
  recommendations?: unknown;
  nextStep?: unknown;
};

const score = (value: unknown) => Math.max(0, Math.min(10, Math.round(Number(value) || 0)));
const text = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim().slice(0, 700) : fallback;
const list = (value: unknown, fallback: string) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 3).map((item) => item.trim().slice(0, 320))
  : [fallback];

export function parseEvaluationResponse(raw: string, conversationId: string, model: string): LocalEvaluation {
  const parsed = JSON.parse(raw) as RawEvaluation;
  const criteria = Object.fromEntries(Object.keys(evaluationCriteriaLabels).map((key) => [key, score(parsed.criteria?.[key])])) as LocalEvaluation["criteria"];
  return {
    id: crypto.randomUUID(),
    conversationId,
    score: Math.round(Math.max(0, Math.min(10, Number(parsed.overallScore) || 0)) * 10),
    summary: text(parsed.summary, "Avaliação concluída com base na conversa disponível."),
    criteria,
    strengths: list(parsed.strengths, "A conversa foi concluída e pode ser revisada."),
    improvements: list(parsed.improvements, "Continue praticando perguntas de descoberta."),
    recommendations: list(parsed.recommendations, "Aplique uma melhoria por vez na próxima simulação."),
    nextStep: text(parsed.nextStep, "Pratique novamente aplicando o feedback desta avaliação."),
    model,
    createdAt: new Date().toISOString(),
  };
}
