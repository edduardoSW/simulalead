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
    objectionAnalysis: { type: "string" },
    evidenceExamples: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    recommendations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
    nextStep: { type: "string" },
  },
  required: ["criteria", "overallScore", "summary", "strengths", "improvements", "objectionAnalysis", "evidenceExamples", "recommendations", "nextStep"],
} as const;

export function buildEvaluationPrompt(conversation: LocalConversation, account?: LocalAccount, product?: LocalProduct) {
  const transcriptLines = conversation.messages
    .filter((message) => message.sender !== "system")
    .map((message) => `${message.sender === "seller" ? "VENDEDOR" : "CLIENTE"}: ${message.text.replace(/\s+/g, " ").trim().slice(0, 4_000)}`);
  const maxTranscriptCharacters = 120_000;
  let transcript = transcriptLines.join("\n");
  if (transcript.length > maxTranscriptCharacters) {
    const retained: string[] = [];
    let retainedLength = 0;
    for (let index = transcriptLines.length - 1; index >= 0; index -= 1) {
      const line = transcriptLines[index];
      if (retainedLength + line.length + 1 > maxTranscriptCharacters) break;
      retained.unshift(line);
      retainedLength += line.length + 1;
    }
    transcript = `[Trecho inicial omitido por limite de contexto; ${transcriptLines.length - retained.length} mensagens anteriores.]\n${retained.join("\n")}`;
  }
  return `Avalie esta simulacao de venda B2B em portugues do Brasil.
Contexto: empresa ${account?.name || "nao informada"}; segmento ${account?.segment || "nao informado"}; solucao relacionada ${product?.name || "nao informada"}.
Regras: avalie apenas comportamentos observaveis do vendedor; nao penalize ausencia de objecao, decisor, fechamento ou informacao que o cliente nao ofereceu; diferencie falha do vendedor de situacao fora do controle dele; use notas inteiras de 0 a 10 por criterio; overallScore deve ser a media aritmetica dos sete criterios; seja direto, pratico e respeitoso; nao invente falas. Em objectionAnalysis, explique como as objecoes existentes foram tratadas ou registre que nao houve objecao observavel. Em evidenceExamples, cite trechos curtos e literais da conversa, identificando VENDEDOR ou CLIENTE, e explique brevemente o que cada trecho evidencia.
Conversa:
${transcript || "Sem mensagens comerciais."}`;
}

type RawEvaluation = {
  criteria?: Record<string, unknown>;
  overallScore?: unknown;
  summary?: unknown;
  strengths?: unknown;
  improvements?: unknown;
  objectionAnalysis?: unknown;
  evidenceExamples?: unknown;
  recommendations?: unknown;
  nextStep?: unknown;
};

const score = (value: number) => Math.max(0, Math.min(10, Math.round(value)));
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const requiredText = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid evaluation field: ${field}`);
  return value.trim().slice(0, 700);
};
const requiredList = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Invalid evaluation field: ${field}`);
  }
  return value.map((item) => (item as string).trim().slice(0, 320));
};

export function parseEvaluationResponse(raw: string, conversationId: string, model: string): LocalEvaluation {
  const parsed = JSON.parse(raw) as RawEvaluation;
  if (!isRecord(parsed) || !isRecord(parsed.criteria)) throw new Error("Invalid evaluation structure");
  const criteria = Object.fromEntries(Object.keys(evaluationCriteriaLabels).map((key) => {
    const value = parsed.criteria?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid evaluation criterion: ${key}`);
    return [key, score(value)];
  })) as NonNullable<LocalEvaluation["criteria"]>;
  if (typeof parsed.overallScore !== "number" || !Number.isFinite(parsed.overallScore)) throw new Error("Invalid evaluation score");
  const calculatedOverall = Object.values(criteria).reduce((total, value) => total + value, 0) / Object.keys(criteria).length;
  return {
    id: crypto.randomUUID(),
    conversationId,
    score: Math.round(calculatedOverall * 10),
    summary: requiredText(parsed.summary, "summary"),
    criteria,
    strengths: requiredList(parsed.strengths, "strengths"),
    improvements: requiredList(parsed.improvements, "improvements"),
    objectionAnalysis: requiredText(parsed.objectionAnalysis, "objectionAnalysis"),
    evidenceExamples: requiredList(parsed.evidenceExamples, "evidenceExamples"),
    recommendations: requiredList(parsed.recommendations, "recommendations"),
    nextStep: requiredText(parsed.nextStep, "nextStep"),
    model,
    createdAt: new Date().toISOString(),
  };
}
