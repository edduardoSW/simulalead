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
  secondaryObjection: "Tem receio do tempo de implantação",
  hiddenConcern: "Não quer interromper a operação da clínica",
  decisionPower: "Influenciadora",
  decisionBarrier: "A diretoria aprova o investimento",
  difficulty: "Fácil",
};
const messages = [{
  id: "seller-1",
  from: "seller",
  text: "Olá Mariana, sou consultor da EJUVV. Como o site atual tem afetado a apresentação dos serviços da clínica?",
}];
const startedAt = Date.now();
const attempt = await generateGeminiContent({
  apiKey,
  model,
  timeoutMs: 30_000,
  body: {
    systemInstruction: { parts: [{ text: buildOptimizedSimulationInstruction(lead, messages) }] },
    contents: toOptimizedGeminiContents(messages),
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 180,
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  },
});

if (!attempt.ok) throw new Error(`Gemini respondeu HTTP ${attempt.status}: ${attempt.data?.error?.status || "erro sem código"}`);
const raw = attempt.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
const reply = parseLeadReply(raw);
if (!isNaturalReply(reply.text)) throw new Error("A resposta da simulação não passou pela validação de naturalidade.");
console.log(JSON.stringify({
  ok: true,
  providerStatus: attempt.status,
  model,
  naturalReply: true,
  responseCharacters: reply.text.length,
  simulationEnded: reply.ended,
  promptTokens: attempt.data?.usageMetadata?.promptTokenCount || 0,
  outputTokens: attempt.data?.usageMetadata?.candidatesTokenCount || 0,
  totalTokens: attempt.data?.usageMetadata?.totalTokenCount || 0,
  durationMs: Date.now() - startedAt,
}, null, 2));
