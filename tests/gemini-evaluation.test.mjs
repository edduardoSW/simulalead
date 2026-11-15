import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvaluationPrompt,
  evaluationCriteriaLabels,
  evaluationResponseSchema,
  parseEvaluationResponse,
} from "../lib/gemini-evaluation.ts";
import { classifyEvaluationProviderFailure } from "../lib/gemini-evaluation-error.ts";

const conversation = {
  id: "conversation-evaluation-1",
  sellerId: "seller-1",
  accountId: "account-1",
  opportunityId: "opportunity-1",
  status: "completed",
  messages: [
    { id: "m1", sender: "seller", text: "Como vocês acompanham os pedidos hoje?", createdAt: "2026-11-14T10:00:00.000Z" },
    { id: "m2", sender: "contact", text: "Usamos planilhas e alguns retornos se perdem.", createdAt: "2026-11-14T10:01:00.000Z" },
    { id: "m3", sender: "seller", text: "Quantos pedidos chegam por semana?", createdAt: "2026-11-14T10:02:00.000Z" },
  ],
};

test("builds a compact evaluation prompt from observable conversation evidence", () => {
  const prompt = buildEvaluationPrompt(
    conversation,
    { id: "account-1", name: "Aurora", segment: "Varejo" },
    { id: "product-1", name: "CRM" },
  );
  assert.match(prompt, /VENDEDOR: Como vocês acompanham/);
  assert.match(prompt, /CLIENTE: Usamos planilhas/);
  assert.match(prompt, /nao penalize ausencia de objecao/i);
  assert.match(prompt, /situacao fora do controle/i);
  assert.ok(prompt.length < 2_000);
});

test("parses all seven criteria and clamps invalid scores", () => {
  const criteria = Object.fromEntries(Object.keys(evaluationCriteriaLabels).map((key, index) => [key, index === 0 ? 14 : index + 3]));
  const evaluation = parseEvaluationResponse(JSON.stringify({
    criteria,
    overallScore: 8.4,
    summary: "Boa descoberta com espaço para um fechamento mais específico.",
    strengths: ["Perguntas objetivas"],
    improvements: ["Confirmar impacto"],
    recommendations: ["Combine data e responsável do próximo passo"],
    nextStep: "Treinar fechamento.",
  }), conversation.id, "gemini-2.5-flash");

  assert.equal(Object.keys(evaluation.criteria).length, 7);
  assert.equal(evaluation.criteria.communicationClarity, 10);
  assert.equal(evaluation.score, 84);
  assert.equal(evaluation.model, "gemini-2.5-flash");
  assert.equal(evaluation.conversationId, conversation.id);
});

test("requires structured fields for every evaluation criterion", () => {
  assert.deepEqual(evaluationResponseSchema.properties.criteria.required, Object.keys(evaluationCriteriaLabels));
  assert.match(JSON.stringify(evaluationResponseSchema), /overallScore/);
});

test("keeps the complete conversation when it fits the evaluation context", () => {
  const longConversation = {
    ...conversation,
    messages: Array.from({ length: 75 }, (_, index) => ({
      id: `message-${index}`,
      sender: index % 2 === 0 ? "seller" : "contact",
      text: index === 0 ? "MARCADOR-INICIAL: abertura da conversa." : `Mensagem comercial ${index}.`,
      createdAt: new Date(2026, 10, 14, 10, index).toISOString(),
    })),
  };
  const prompt = buildEvaluationPrompt(longConversation);
  assert.match(prompt, /MARCADOR-INICIAL/);
  assert.match(prompt, /Mensagem comercial 74/);
});

test("rejects incomplete provider output before it can be persisted", () => {
  assert.throws(
    () => parseEvaluationResponse(JSON.stringify({ overallScore: 8, summary: "Incompleta" }), conversation.id, "gemini-2.5-flash-lite"),
    /Invalid evaluation structure/,
  );
});

test("maps Gemini provider errors to specific evaluation messages", () => {
  const model = "gemini-2.5-flash-lite";
  assert.match(classifyEvaluationProviderFailure({ status: 400, error: "invalid" }, model).body.error, /configuração.*400/i);
  assert.match(classifyEvaluationProviderFailure({ status: 401, error: "unauthenticated" }, model).body.error, /chave.*inválida.*401/i);
  assert.match(classifyEvaluationProviderFailure({ status: 403, error: "forbidden" }, model).body.error, /permissão.*403/i);
  assert.match(classifyEvaluationProviderFailure({ status: 404, error: "not found" }, model).body.error, /gemini-2\.5-flash-lite.*404/i);
  assert.match(classifyEvaluationProviderFailure({ status: 429, error: "quota", quotaReason: "requestsPerDay" }, model).body.error, /cota diária.*429/i);
  assert.match(classifyEvaluationProviderFailure({ status: 500, error: "internal" }, model).body.error, /erro interno.*500/i);
});
