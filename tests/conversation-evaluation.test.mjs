import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationEvaluation } from "../lib/conversation-evaluation.ts";

const conversation = {
  id: "conversation-1",
  opportunityId: "opportunity-1",
  accountId: "account-1",
  currentContactId: "contact-1",
  sellerId: "seller-1",
  status: "completed",
  unread: 0,
  updatedAt: "2026-11-14T10:00:00.000Z",
  handoffs: [],
  messages: [
    { id: "1", sender: "seller", text: "Olá, sou Eduardo. Como vocês recebem novos pedidos hoje?", createdAt: "2026-11-14T09:00:00.000Z" },
    { id: "2", sender: "contact", text: "Hoje fazemos tudo manualmente.", createdAt: "2026-11-14T09:01:00.000Z" },
    { id: "3", sender: "seller", text: "Qual impacto isso causa na equipe?", createdAt: "2026-11-14T09:02:00.000Z" },
    { id: "4", sender: "contact", text: "Perdemos tempo e alguns pedidos.", createdAt: "2026-11-14T09:03:00.000Z" },
    { id: "5", sender: "seller", text: "Podemos ajudar a reduzir esse trabalho. Faz sentido agendar uma reunião curta?", createdAt: "2026-11-14T09:04:00.000Z" },
  ],
};

test("creates actionable feedback for a completed sales conversation", () => {
  const evaluation = buildConversationEvaluation(conversation);
  assert.equal(evaluation.conversationId, conversation.id);
  assert.ok(evaluation.score >= 80);
  assert.ok(evaluation.strengths.length > 0);
  assert.ok(evaluation.improvements.length > 0);
  assert.match(evaluation.nextStep, /próxima simulação/i);
});
