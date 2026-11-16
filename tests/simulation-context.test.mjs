import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildConversationMemory,
  buildOptimizedSimulationInstruction,
  buildSimulationInstruction,
  deriveCommercialState,
  normalizeSimulationMessages,
  parseLeadReply,
  selectSimulationContext,
  selectOptimizedSimulationContext,
  simulationEndedMarker,
  shouldDeclineEarlyMeeting,
  toGeminiContents,
  toOptimizedGeminiContents,
} from "../lib/simulation-context.ts";
import {
  generationKey,
  isCurrentGeneration,
  reconcileGenerationErrors,
} from "../lib/generation-state.ts";

const bruno = {
  id: "lead-bruno",
  name: "Bruno Freitas",
  role: "Gerente",
  company: "Aurora Foods",
  segment: "Alimentos",
  companySize: "10-49 pessoas",
  problem: "As vendas dependem exclusivamente de canais fisicos",
  solution: "E-commerce",
  communicationStyle: "objetivo, cordial e pratico",
  visibleObjection: "Minha equipe nao tera tempo",
  secondaryObjection: "nao quer sobrecarregar a equipe durante a implantacao",
  hiddenConcern: "nao confia no retorno prometido",
  decisionPower: "Influenciador, depende de aprovacao",
  decisionBarrier: "precisa conversar com a diretoria",
  difficulty: "Intermediário",
  contacts: [{ name: "Bruno Freitas", jobTitle: "Gerente", department: "Comercial", buyingRole: "influencer", status: "known" }],
};

test("keeps Bruno's opening at greeting/name level before any service is presented", () => {
  const messages = [
    { from: "seller", text: "Olá Bruno, tudo bem?" },
    { from: "lead", text: "Opa, tudo bem? Por aqui tudo certo. Com quem eu falo e sobre o que seria?" },
    { from: "seller", text: "Boa tarde, me chamo Pedro, sou representante da EJUVV, qual seu nome?" },
  ];
  const state = deriveCommercialState(bruno, messages);
  assert.equal(state.asksForLeadName, true);
  assert.equal(state.openingOrIntroOnly, true);
  assert.equal(state.solutionPresentedBySeller, false);
  assert.equal(state.objectionIsPertinent, false);

  const prompt = buildSimulationInstruction(bruno, messages);
  assert.match(prompt, /Se o vendedor perguntar seu nome, apresente-se/i);
  assert.match(prompt, /O servico relacionado e interno; nao presuma que o vendedor ja ofereceu esse servico/i);
  assert.doesNotMatch(prompt, /apresente uma obje[cç]ao realista\./i);
});

test("maps the conversation history to Gemini roles in chronological order without duplicating ids", () => {
  const messages = normalizeSimulationMessages([
    { id: "m2", from: "lead", text: "Oi, sou a Renata.", createdAt: "2026-09-11T12:01:00.000Z" },
    { id: "m1", from: "seller", text: "Bom dia, qual seu nome?", createdAt: "2026-09-11T12:00:00.000Z" },
    { id: "m2", from: "lead", text: "Oi, sou a Renata.", createdAt: "2026-09-11T12:01:00.000Z" },
    { id: "m3", from: "seller", text: "Obrigado.", createdAt: "2026-09-11T12:02:00.000Z" },
  ]);
  assert.deepEqual(messages.map((message) => message.id), ["m1", "m2", "m3"]);
  assert.deepEqual(toGeminiContents(messages).map((content) => content.role), ["user", "model", "user"]);
});

test("keeps recent turns and older commercial commitments without generating a summary", () => {
  const messages = Array.from({ length: 22 }, (_, index) => ({
    id: `m-${index}`,
    from: index % 2 === 0 ? "seller" : "lead",
    text: index === 2 ? "Combinamos uma reuniao na sexta e o orcamento sera enviado." : `Mensagem de contexto ${index}.`,
  }));
  const selected = selectSimulationContext(messages);
  assert.ok(selected.length <= 16);
  assert.ok(selected.some((message) => message.id === "m-2"));
  assert.deepEqual(selected.slice(-12).map((message) => message.id), messages.slice(-12).map((message) => message.id));
});

test("uses local extractive memory and sends only the recent conversation window", () => {
  const messages = Array.from({ length: 24 }, (_, index) => ({
    id: `memory-${index}`,
    from: index % 2 === 0 ? "seller" : "lead",
    text: index === 4
      ? "Combinamos que o orçamento será enviado e a diretoria decide na sexta."
      : `Mensagem detalhada de continuidade comercial ${index} com informacoes da negociacao.`,
  }));
  const memory = buildConversationMemory(messages);
  const selected = selectOptimizedSimulationContext(messages);
  assert.match(memory, /orçamento será enviado/i);
  assert.ok(selected.length <= 8);
  assert.deepEqual(selected.map((message) => message.id), messages.slice(-8).map((message) => message.id));

  const oldPayloadCharacters = buildSimulationInstruction(bruno, messages).length + JSON.stringify(toGeminiContents(messages)).length;
  const optimizedPrompt = buildOptimizedSimulationInstruction(bruno, messages);
  const optimizedPayloadCharacters = optimizedPrompt.length + JSON.stringify(toOptimizedGeminiContents(messages)).length;
  assert.match(optimizedPrompt, /Bruno Freitas/);
  assert.match(optimizedPrompt, /Minha equipe nao tera tempo/);
  assert.match(optimizedPrompt, /nao confia no retorno prometido/);
  assert.match(optimizedPrompt, /influencer/i);
  assert.ok(optimizedPayloadCharacters < oldPayloadCharacters * 0.7, `${optimizedPayloadCharacters} should be below 70% of ${oldPayloadCharacters}`);
});

test("does not treat the related service as a presented proposal until the seller says it", () => {
  const early = deriveCommercialState(bruno, [{ from: "seller", text: "Sou Pedro, da EJUVV. Sobre o que seria melhor falar ai?" }]);
  assert.equal(early.solutionPresentedBySeller, false);
  assert.equal(early.canEvaluateSolution, false);

  const afterPitch = deriveCommercialState(bruno, [
    { from: "seller", text: "Sou Pedro, da EJUVV." },
    { from: "seller", text: "A gente ajuda com e-commerce para abrir um canal de vendas online." },
  ]);
  assert.equal(afterPitch.solutionPresentedBySeller, true);
  assert.equal(afterPitch.canEvaluateSolution, true);
  assert.equal(afterPitch.objectionIsPertinent, true);
});

test("derives adaptive negotiation state locally without another Gemini call", () => {
  const state = deriveCommercialState(bruno, [
    { from: "seller", text: "Como esse processo afeta a equipe hoje?" },
    { from: "lead", text: "Usamos planilhas, mas tenho receio do tempo de implantação." },
    { from: "seller", text: "Entendo esse receio. Podemos conduzir um piloto de duas semanas com métricas de adoção." },
  ]);
  assert.equal(state.consultativeQuestionCount, 1);
  assert.equal(state.specificArgumentCount, 1);
  assert.equal(state.trustLevel, "developing");
  assert.equal(state.pendingObjection, false);
  assert.equal(state.pressureAttemptCount, 0);
});

test("keeps different leads differentiated through persistent identity and role context", () => {
  const opening = [{ from: "seller", text: "Olá, tudo bem?" }];
  const leads = [
    bruno,
    { ...bruno, id: "lead-ana", name: "Ana Lima", role: "Assistente", company: "Delta Edu", decisionPower: "Gatekeeper", contacts: [{ name: "Ana Lima", jobTitle: "Assistente", department: "Administrativo", buyingRole: "gatekeeper", status: "known" }] },
    { ...bruno, id: "lead-marina", name: "Marina Reis", role: "Diretora", company: "Nexo BI", decisionPower: "Decisora final", contacts: [{ name: "Marina Reis", jobTitle: "Diretora", department: "Diretoria", buyingRole: "decision_maker", status: "known" }] },
  ];
  const prompts = leads.map((lead) => buildSimulationInstruction(lead, opening));
  assert.match(prompts[0], /Bruno Freitas/);
  assert.match(prompts[1], /gatekeeper/i);
  assert.match(prompts[2], /Decisora final/i);
  assert.equal(new Set(prompts).size, 3);
});

test("declines premature meetings without using the persona objection fallback", () => {
  assert.equal(shouldDeclineEarlyMeeting([{ from: "seller", text: "Podemos marcar uma reunião de 30 minutos amanhã?" }]), true);
  assert.equal(shouldDeclineEarlyMeeting([
    { from: "seller", text: "Como funciona hoje?" },
    { from: "lead", text: "Ainda e tudo manual." },
    { from: "seller", text: "Posso explicar um projeto de e-commerce." },
    { from: "seller", text: "A ideia seria entender estoque, pagamento e entrega antes." },
    { from: "seller", text: "Podemos marcar uma reunião?" },
  ]), false);
});

test("turns an explicit in-character closure into persisted simulation state", () => {
  const parsed = parseLeadReply(`Nao aceito esse tipo de abordagem. Vou encerrar por aqui. ${simulationEndedMarker}`);
  assert.equal(parsed.ended, true);
  assert.equal(parsed.text, "Nao aceito esse tipo de abordagem. Vou encerrar por aqui.");
  assert.match(buildSimulationInstruction(bruno, [{ from: "seller", text: "Mensagem ofensiva" }]), /nao trate isso como erro tecnico/i);
});

test("reconciles errors only with a response from the same request batch", () => {
  const conversations = [{
    id: "conversation-1",
    messages: [{ id: "lead-1", sender: "contact", text: "Resposta anterior.", createdAt: "2026-10-01T10:00:00.000Z", batchId: "batch-1" }],
  }];
  const errors = {
    [generationKey("conversation-1", "batch-1")]: { conversationId: "conversation-1", batchId: "batch-1", requestId: "request-1", message: "erro antigo" },
    [generationKey("conversation-1", "batch-2")]: { conversationId: "conversation-1", batchId: "batch-2", requestId: "request-2", message: "erro atual" },
  };
  const reconciled = reconcileGenerationErrors(errors, conversations);
  assert.equal(reconciled[generationKey("conversation-1", "batch-1")], undefined);
  assert.equal(reconciled[generationKey("conversation-1", "batch-2")].message, "erro atual");
});

test("does not let a late operation mutate the state of its replacement", () => {
  const active = new Map([["conversation-1", { batchId: "batch-1", requestId: "request-new", operationId: "operation-new", phase: "generating" }]]);
  assert.equal(isCurrentGeneration(active, "conversation-1", "operation-old"), false);
  assert.equal(isCurrentGeneration(active, "conversation-1", "operation-new"), true);
});

test("does not fabricate commercial lead replies on technical failures", async () => {
  const route = await readFile(new URL("../app/api/simulate/route.ts", import.meta.url), "utf8");
  const inbox = await readFile(new URL("../components/LocalConversations.tsx", import.meta.url), "utf8");
  const trainings = await readFile(new URL("../components/LocalTrainings.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(route, /local-persona-fallback|buildFallbackReply|Entendi, mas ainda ficou um pouco gen[eé]rico/i);
  assert.match(route, /technical:\s*true/);
  assert.doesNotMatch(inbox, /result\.text\|\|result\.error\|\|/);
  assert.doesNotMatch(inbox, /Recebi suas mensagens\. Vou analisar/);
  assert.doesNotMatch(trainings, /Pode explicar isso de maneira mais concreta\?|Ainda n[aã]o ficou claro para mim/);
});

test("binds async replies to the originating conversation request", async () => {
  const [route, inbox, workspace, trainings] = await Promise.all([
    readFile(new URL("../app/api/simulate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/LocalConversations.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/LocalWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/LocalTrainings.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /conversationId:\s*requestBody\.conversationId/);
  assert.match(route, /requestId:\s*requestBody\.requestId/);
  assert.match(inbox, /const sourceConversation = conversation/);
  assert.match(workspace, /result\.conversationId && result\.conversationId !== conversationId/);
  assert.match(trainings, /sessionRef\.current !== requestSession/);
});

test("recovers a pending generation without automatically resending it", async () => {
  const workspace = await readFile(new URL("../components/LocalWorkspace.tsx", import.meta.url), "utf8");

  assert.match(workspace, /method:\s*"GET"/);
  assert.match(workspace, /result\.status === "processing"/);
  assert.match(workspace, /result\.status === "completed"/);
  assert.match(workspace, /result\.status === "interrupted"/);
  assert.match(workspace, /A resposta foi interrompida durante a recarga/);
  const recoveryFlow = workspace.slice(workspace.indexOf("const recoverBatch"), workspace.indexOf("const confirmBatch"));
  assert.doesNotMatch(recoveryFlow, /method:\s*"POST"/);
});

test("checks persisted status before retrying and reconciles a saved response", async () => {
  const [workspace, route, migration] = await Promise.all([
    readFile(new URL("../components/LocalWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/simulate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202610010003_reconcile_simulation_generations.sql", import.meta.url), "utf8"),
  ]);
  const confirmStart = workspace.indexOf("const confirmBatch");
  const confirmEnd = workspace.indexOf("useEffect(() =>", confirmStart);
  const confirmFlow = workspace.slice(confirmStart, confirmEnd);
  assert.ok(confirmFlow.indexOf('method: "GET"') < confirmFlow.indexOf('method: "POST"'));
  assert.match(workspace, /isCurrentGeneration/);
  assert.match(route, /reconcilePersistedResponse/);
  assert.match(migration, /reconcile_simulation_generation/);
  assert.match(migration, /status = 'completed'/);
});

test("limits Gemini consumption and records provider calls and tokens", async () => {
  const [route, migration] = await Promise.all([
    readFile(new URL("../app/api/simulate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202611140002_gemini_efficiency.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /GEMINI_MAX_OUTPUT_TOKENS",\s*180/);
  assert.match(route, /"gemini-3\.5-flash-lite"/);
  assert.match(route, /configuredThinkingLevel/);
  assert.match(route, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.doesNotMatch(route, /const models\s*=/);
  assert.match(route, /check_gemini_usage_limit/);
  assert.match(route, /isDailyOrBillingQuota/);
  assert.match(route, /record_simulation_generation_usage/);
  assert.match(migration, /gemini_usage_events/);
  assert.match(migration, /grant execute on function public\.record_simulation_generation_usage[\s\S]*to service_role/);
  assert.match(migration, /cached_tokens/);
  assert.match(migration, /PROJECT_DAILY_QUOTA/);
  assert.match(migration, /USER_RPM_LIMIT/);
  assert.match(migration, /gemini_request_reservations/);
  assert.match(migration, /security_invoker = true/);
});

test("separates simulation and final evaluation Gemini workloads", async () => {
  const [simulationRoute, evaluationRoute, geminiClient, migration, envExample] = await Promise.all([
    readFile(new URL("../app/api/simulate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evaluate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/gemini-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202611140002_gemini_efficiency.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(simulationRoute, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(simulationRoute, /GEMINI_EVALUATION_API_KEY/);
  assert.match(evaluationRoute, /process\.env\.GEMINI_EVALUATION_API_KEY/);
  assert.doesNotMatch(evaluationRoute, /process\.env\.GEMINI_API_KEY\b/);
  assert.match(simulationRoute, /generateGeminiContent/);
  assert.match(evaluationRoute, /generateGeminiContent/);
  assert.doesNotMatch(simulationRoute, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(evaluationRoute, /generativelanguage\.googleapis\.com/);
  assert.match(geminiClient, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(geminiClient, /"x-goog-api-key": apiKey/);
  assert.match(evaluationRoute, /conversation\.status !== "completed"/);
  assert.match(evaluationRoute, /evaluationsInFlight/);
  assert.match(evaluationRoute, /record_gemini_evaluation_usage/);
  assert.match(evaluationRoute, /thinkingLevel:\s*"minimal"/);
  assert.doesNotMatch(evaluationRoute, /thinkingBudget/);
  assert.match(migration, /operation_kind text not null default 'simulation'/);
  assert.match(migration, /'evaluation', requested_request_id, 'evaluation'/);
  assert.match(envExample, /GEMINI_MODEL=gemini-3\.5-flash-lite/);
  assert.match(envExample, /GEMINI_EVALUATION_MODEL=gemini-3\.5-flash-lite/);
});

test("keeps independent training authenticated and isolated from persisted lead conversations", async () => {
  const [component, route, usageMigration, sessionMigration] = await Promise.all([
    readFile(new URL("../components/LocalTrainings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/training/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202611150002_independent_training_usage.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202611150005_persist_independent_training_sessions.sql", import.meta.url), "utf8"),
  ]);
  assert.match(component, /fetch\("\/api\/training"/);
  assert.match(component, /authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(component, /fetch\("\/api\/simulate"/);
  assert.match(route, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(route, /GEMINI_EVALUATION_API_KEY/);
  assert.match(route, /check_gemini_usage_limit/);
  assert.match(route, /record_independent_training_usage/);
  assert.match(route, /requestsInFlight/);
  assert.doesNotMatch(route, /user_simulations/);
  assert.match(route, /claim_independent_training_turn/);
  assert.match(route, /complete_independent_training_turn/);
  assert.doesNotMatch(route, /body\.messages/);
  assert.match(component, /independent_training_sessions/);
  assert.match(component, /start_independent_training_session/);
  assert.match(component, /sellerText/);
  assert.match(usageMigration, /operation_kind[^\n]*'simulation'/);
  assert.match(usageMigration, /grant execute[^\n]*to service_role/);
  assert.match(sessionMigration, /primary key \(seller_id, conversation_id\)/);
  assert.match(sessionMigration, /request_id/);
  assert.match(sessionMigration, /jsonb_set\(v_payload, '\{messages\}'/);
});

test("retries only temporary evaluation failures and does not mask credential errors", async () => {
  const evaluationRoute = await readFile(new URL("../app/api/evaluate/route.ts", import.meta.url), "utf8");
  assert.match(evaluationRoute, /"gemini-3\.5-flash-lite"/);
  assert.match(evaluationRoute, /classifyEvaluationProviderFailure/);
  assert.doesNotMatch(evaluationRoute, /await new Promise\(\(resolve\) => setTimeout/);
  assert.equal((evaluationRoute.match(/await callGemini\(/g) || []).length, 1);
  assert.match(evaluationRoute, /attemptNumber < 3/);
  assert.match(evaluationRoute, /\[500, 502, 503, 504\]\.includes/);
  assert.match(evaluationRoute, /persist_gemini_evaluation/);
});

test("exposes tenant-scoped Gemini monitoring by user and simulation", async () => {
  const [migration, panel] = await Promise.all([
    readFile(new URL("../supabase/migrations/202611140002_gemini_efficiency.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/GeminiUsagePanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /create policy gemini_usage_events_read/);
  assert.match(migration, /seller_id = auth\.uid\(\)/);
  assert.match(migration, /public\.has_role\(array\['admin','manager'\]/);
  assert.match(panel, /gemini_usage_by_user/);
  assert.match(panel, /gemini_usage_by_simulation/);
  assert.match(panel, /operation_kind/);
});

test("persists idempotent generation state behind authenticated ownership checks", async () => {
  const [route, repository, migration] = await Promise.all([
    readFile(new URL("../app/api/simulate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202610010001_durable_simulation_recovery.sql", import.meta.url), "utf8"),
  ]);

  assert.match(route, /client\.auth\.getUser\(accessToken\)/);
  assert.match(route, /loadPersistedSnapshot/);
  assert.match(route, /claim_simulation_generation/);
  assert.match(route, /complete_simulation_generation/);
  assert.match(repository, /\.eq\("seller_id", this\.userId\)/);
  assert.match(migration, /primary key \(seller_id, conversation_id, batch_id\)/i);
  assert.match(migration, /seller_id = auth\.uid\(\)/i);
  assert.match(migration, /Legacy workspace JSON is deliberately not rewritten/i);
});

test("restores the selected conversation id in the URL and orders persisted messages", async () => {
  const [workspace, domain] = await Promise.all([
    readFile(new URL("../components/LocalWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/local-domain.ts", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /searchParams\.get\("conversation"\)/);
  assert.match(workspace, /replaceState\(null, "", path\)/);
  assert.match(domain, /new Date\(a\.createdAt\)\.getTime\(\)-new Date\(b\.createdAt\)\.getTime\(\)/);
});
