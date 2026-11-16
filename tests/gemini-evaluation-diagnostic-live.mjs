import { readFile } from "node:fs/promises";

import { buildEvaluationPrompt, evaluationResponseSchema } from "../lib/gemini-evaluation.ts";
import { generateGeminiContent } from "../lib/gemini-client.ts";

const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
for (const line of source.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
}

const apiKey = process.env.GEMINI_EVALUATION_API_KEY?.trim();
const model = process.env.GEMINI_EVALUATION_MODEL?.trim();
if (!apiKey || !model) throw new Error("Configuração de avaliação ausente.");

const conversation = {
  id: "diagnostic-evaluation",
  status: "completed",
  messages: [
    { sender: "seller", text: "Como vocês qualificam oportunidades hoje?" },
    { sender: "contact", text: "Usamos planilhas, mas não vou detalhar o processo agora." },
    { sender: "seller", text: "Qual impacto isso causa no acompanhamento?" },
  ],
};
const prompt = buildEvaluationPrompt(conversation);
const variants = [
  { label: "plain", generationConfig: { maxOutputTokens: 900 } },
  { label: "json", generationConfig: { maxOutputTokens: 900, responseMimeType: "application/json" } },
  { label: "schema", generationConfig: { maxOutputTokens: 900, responseMimeType: "application/json", responseSchema: evaluationResponseSchema } },
  { label: "schema-thinking", generationConfig: { maxOutputTokens: 900, responseMimeType: "application/json", responseSchema: evaluationResponseSchema, thinkingConfig: { thinkingLevel: "minimal" } } },
];

const results = [];
for (const variant of variants) {
  const attempt = await generateGeminiContent({
    apiKey,
    model,
    timeoutMs: 24_000,
    body: {
      systemInstruction: { parts: [{ text: "Avalie treinamento B2B. Responda somente com o formato solicitado." }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: variant.generationConfig,
    },
  });
  results.push({
    label: variant.label,
    status: attempt.status,
    providerStatus: attempt.data?.error?.status || null,
    finishReason: attempt.data?.candidates?.[0]?.finishReason || null,
    hasText: Boolean(attempt.data?.candidates?.[0]?.content?.parts?.some((part) => part.text)),
    durationMs: attempt.durationMs,
  });
}

console.log(JSON.stringify(results, null, 2));
