import { readFile } from "node:fs/promises";

import { generateGeminiContent } from "../lib/gemini-client.ts";
import {
  buildOptimizedSimulationInstruction,
  parseLeadReply,
  toOptimizedGeminiContents,
} from "../lib/simulation-context.ts";

const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
for (const line of source.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim();
if (!apiKey || !model) throw new Error("Configuração de simulação ausente.");

const baseLead = {
  name: "Carla Mendes",
  role: "Coordenadora administrativa",
  company: "Conta Clara Construtora",
  segment: "Construção civil",
  companySize: "50-199 pessoas",
  problem: "A equipe controla propostas e retornos em planilhas e ferramentas internas",
  solution: "CRM comercial",
  communicationStyle: "objetiva, reservada e prática",
  visibleObjection: "A equipe costuma resistir a novas ferramentas",
  secondaryObjection: "Não quer interromper a operação durante a implantação",
  hiddenConcern: "Uma implantação anterior aumentou o retrabalho e foi abandonada",
  motivation: "Reduzir perda de retornos sem criar mais tarefas para a equipe",
  decisionPower: "Influenciadora; diretoria e TI aprovam",
  decisionBarrier: "Precisa de evidência de adoção, integração e retorno financeiro",
  meetingConditions: "Diagnóstico específico e resposta convincente sobre adoção e implantação",
  possibleOutcome: "Pode recusar ou encerrar se a abordagem continuar genérica ou pressionar",
};

const sellerTurns = [
  ["abordagem-generica", "Olá, Carla. Temos uma solução inovadora que pode transformar os resultados da Conta Clara. Gostaria de conhecer?"],
  ["pergunta-consultiva", "Antes de falar da solução, como vocês acompanham hoje propostas e retornos, e em qual etapa a equipe sente mais dificuldade?"],
  ["tratamento-objecao", "Entendo a preocupação com adoção. Podemos começar com um piloto de duas semanas, medir uso e retrabalho e só então decidir a expansão."],
  ["apresentacao-preco", "Para esse porte, o investimento inicial é de R$ 18 mil, além de R$ 1.500 mensais. O valor inclui implantação e treinamento."],
  ["negociacao", "Posso reduzir a implantação para R$ 15 mil se definirmos o projeto ainda esta semana."],
  ["fechamento", "Podemos fechar hoje e marcar o início da implantação para segunda-feira?"],
];

async function runLevel(difficulty) {
  const lead = { ...baseLead, difficulty };
  const messages = [];
  const transcript = [];
  let totalTokens = 0;
  for (const [stage, text] of sellerTurns) {
    messages.push({ id: crypto.randomUUID(), from: "seller", text });
    let attempt;
    for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
      attempt = await generateGeminiContent({
        apiKey,
        model,
        timeoutMs: 16_000,
        body: {
          systemInstruction: { parts: [{ text: buildOptimizedSimulationInstruction(lead, messages) }] },
          contents: toOptimizedGeminiContents(messages),
          generationConfig: {
            temperature: difficulty === "Difícil" ? 0.8 : 0.7,
            maxOutputTokens: 180,
            thinkingConfig: { thinkingLevel: "minimal" },
          },
        },
      });
      if (attempt.ok || ![500, 502, 503, 504].includes(attempt.status)) break;
    }
    if (!attempt?.ok) {
      return {
        difficulty,
        turns: transcript,
        totalTokens,
        error: { stage, status: attempt?.status || 0, providerStatus: attempt?.data?.error?.status || null },
      };
    }
    const raw = attempt.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
    const reply = parseLeadReply(raw);
    messages.push({ id: crypto.randomUUID(), from: "lead", text: reply.text });
    transcript.push({ stage, seller: text, lead: reply.text, ended: reply.ended });
    totalTokens += Number(attempt.data?.usageMetadata?.totalTokenCount || 0);
    if (reply.ended) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return { difficulty, turns: transcript, totalTokens };
}

const requestedLevel = process.argv[2];
const levels = requestedLevel ? [requestedLevel] : ["Fácil", "Intermediário", "Difícil"];
const results = [];
for (const difficulty of levels) results.push(await runLevel(difficulty));
console.log(JSON.stringify({ model, results }, null, 2));
