import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvaluationPrompt,
  evaluationCriteriaLabels,
  evaluationResponseSchema,
  parseEvaluationResponse,
} from "../lib/gemini-evaluation.ts";

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
