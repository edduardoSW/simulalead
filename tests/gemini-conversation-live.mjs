import { readFile } from "node:fs/promises";

import { generateGeminiContent } from "../lib/gemini-client.ts";
import {
  buildOptimizedSimulationInstruction,
  isNaturalReply,
  parseLeadReply,
  toOptimizedGeminiContents,
} from "../lib/simulation-context.ts";

async function loadLocalEnvironment() {
  const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

await loadLocalEnvironment();
const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim();
if (!apiKey || !model) throw new Error("Configure GEMINI_API_KEY e GEMINI_MODEL em .env.local.");

const lead = {
  name: "Mariana Lopes",
  role: "Coordenadora administrativa",
  company: "Clínica Serena",
  segment: "Saúde",
  companySize: "10-49 pessoas",
  problem: "O site atual não representa os serviços da clínica",
  solution: "Site institucional",
  communicationStyle: "objetiva, cordial e cautelosa",
  visibleObjection: "Preciso entender o valor antes de envolver a diretoria",
  hiddenConcern: "Não quer interromper a operação da clínica",
  decisionPower: "Influenciadora",
  decisionBarrier: "A diretoria aprova o investimento",
  difficulty: "Fácil",
};
const sellerTurns = [
  "Olá Mariana, como o site atual tem afetado a apresentação dos serviços da clínica?",
  "Entendi. Qual impacto isso tem nos contatos de novos pacientes e no trabalho da equipe?",
];
const messages = [];
let totalTokens = 0;
let promptTokens = 0;
let outputTokens = 0;
const startedAt = Date.now();

for (let index = 0; index < sellerTurns.length; index += 1) {
  messages.push({ id: `seller-${index}`, from: "seller", text: sellerTurns[index] });
  const attempt = await generateGeminiContent({
    apiKey,
    model,
    timeoutMs: 30_000,
    body: {
      systemInstruction: { parts: [{ text: buildOptimizedSimulationInstruction(lead, messages) }] },
      contents: toOptimizedGeminiContents(messages),
      generationConfig: { temperature: 0.7, maxOutputTokens: 180, thinkingConfig: { thinkingLevel: "minimal" } },
    },
  });
  if (!attempt.ok) throw new Error(`Turno ${index + 1}: Gemini respondeu HTTP ${attempt.status} (${attempt.data?.error?.status || "sem status"}).`);
  const raw = attempt.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  const reply = parseLeadReply(raw);
  if (!isNaturalReply(reply.text)) throw new Error(`Turno ${index + 1}: resposta não passou pela validação de naturalidade.`);
  messages.push({ id: `lead-${index}`, from: "lead", text: reply.text });
  promptTokens += Number(attempt.data?.usageMetadata?.promptTokenCount || 0);
  outputTokens += Number(attempt.data?.usageMetadata?.candidatesTokenCount || 0);
  totalTokens += Number(attempt.data?.usageMetadata?.totalTokenCount || 0);
}

console.log(JSON.stringify({
  ok: true,
  providerStatus: 200,
  model,
  providerCalls: sellerTurns.length,
  contextMessages: messages.length,
  naturalReplies: messages.filter((message) => message.from === "lead").length,
  promptTokens,
  outputTokens,
  totalTokens,
  durationMs: Date.now() - startedAt,
}, null, 2));
