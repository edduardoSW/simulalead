import { readFile } from "node:fs/promises";

import {
  buildEvaluationPrompt,
  evaluationResponseSchema,
  parseEvaluationResponse,
} from "../lib/gemini-evaluation.ts";

async function loadLocalEnvironment() {
  const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

await loadLocalEnvironment();

const apiKey = process.env.GEMINI_EVALUATION_API_KEY?.trim();
const model = process.env.GEMINI_EVALUATION_MODEL?.trim();
if (!apiKey || !model) throw new Error("Configure GEMINI_EVALUATION_API_KEY e GEMINI_EVALUATION_MODEL em .env.local.");

const conversation = {
  id: "live-evaluation-smoke-test",
  accountId: "account-test",
  opportunityId: "opportunity-test",
  status: "completed",
  messages: [
    { sender: "client", text: "Precisamos reduzir o tempo gasto pela equipe para qualificar novos leads." },
    { sender: "seller", text: "Entendi. Quantas pessoas fazem essa qualificação hoje e onde ocorre o maior atraso?" },
    { sender: "client", text: "São quatro vendedores e perdemos tempo organizando o contexto antes das ligações." },
    { sender: "seller", text: "O SimulaLead prepara treinamentos realistas para a equipe praticar cenários antes das conversas comerciais. Qual seria o impacto de reduzir esse preparo manual?" },
    { sender: "client", text: "Teríamos mais consistência, mas estou preocupado com a adoção da equipe." },
    { sender: "seller", text: "Podemos começar com um piloto curto, acompanhar os resultados e ajustar os cenários com o time. Faz sentido agendarmos uma demonstração com o gestor comercial?" },
    { sender: "client", text: "Sim, envie dois horários para a próxima semana." },
  ],
};

const prompt = buildEvaluationPrompt(
  conversation,
  { id: "account-test", name: "Empresa de teste", segment: "Serviços B2B" },
  { id: "product-test", name: "Treinamento comercial com IA" },
);

const startedAt = Date.now();
const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
  body: JSON.stringify({
    systemInstruction: { parts: [{ text: "Voce e um avaliador de treinamento comercial B2B. Responda somente com o JSON solicitado, sem markdown." }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 900,
      responseMimeType: "application/json",
      responseSchema: evaluationResponseSchema,
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  }),
});

const payload = await response.json();
if (!response.ok) {
  throw new Error(`Gemini respondeu HTTP ${response.status}: ${payload?.error?.status || "erro sem codigo"}`);
}

const raw = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
const evaluation = parseEvaluationResponse(raw, conversation.id, model);
console.log(JSON.stringify({
  ok: true,
  providerStatus: response.status,
  model: evaluation.model,
  score: evaluation.score,
  criteria: evaluation.criteria,
  strengths: evaluation.strengths.length,
  improvements: evaluation.improvements.length,
  recommendations: evaluation.recommendations.length,
  hasSummary: evaluation.summary.length > 0,
  hasNextStep: evaluation.nextStep.length > 0,
  promptTokens: payload?.usageMetadata?.promptTokenCount || 0,
  outputTokens: payload?.usageMetadata?.candidatesTokenCount || 0,
  totalTokens: payload?.usageMetadata?.totalTokenCount || 0,
  durationMs: Date.now() - startedAt,
}, null, 2));
