"use client";
import { useEffect, useRef, useState } from "react";
import type { LocalAccount, LocalData, LocalMessage } from "../lib/local-domain";
import { generationKey, hasBatchResponse, type ActiveGeneration, type GenerationErrors } from "../lib/generation-state";

type Sender = "seller" | "contact";
type GenerationState = Record<string, ActiveGeneration>;
type Props = {
  data: LocalData;
  selectedConversationId: string;
  scrollStorageKeyPrefix: string;
  activeGenerations: GenerationState;
  generationErrors: GenerationErrors;
  evaluatingConversationId: string;
  onSelect: (conversationId: string) => void;
  onRead: (conversationId: string) => Promise<void>;
  onSend: (id: string, text: string, contactId?: string, sender?: Sender, batchId?: string, requestId?: string) => Promise<void>;
  onConfirmBatch: (conversationId: string, batchId: string) => Promise<void>;
  onFinalize: (conversationId: string) => Promise<void>;
  onEvaluate: (conversationId: string) => Promise<void>;
  onStartAnother: () => void;
};

export function LocalConversations({ data, selectedConversationId, scrollStorageKeyPrefix, activeGenerations, generationErrors, evaluatingConversationId, onSelect, onRead, onSend, onConfirmBatch, onFinalize, onEvaluate, onStartAnother }: Props) {
  const valid = data.conversations.filter((conversation) =>
    data.accounts.some((account) => account.id === conversation.accountId) &&
    data.opportunities.some((opportunity) => opportunity.id === conversation.opportunityId || opportunity.accountId === conversation.accountId),
  );
  const selected = selectedConversationId || valid[0]?.id || "";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftBatchIds, setDraftBatchIds] = useState<Record<string, string>>({});
  const [locallyConfirmed, setLocallyConfirmed] = useState<Record<string, boolean>>({});
  const confirmLocks = useRef(new Set<string>());
  const input = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const restoringScrollRef = useRef(false);
  const conversation = valid.find((item) => item.id === selected) || valid[0];
  const conversationId = conversation?.id;
  const activeGeneration = conversation ? activeGenerations[conversation.id] : undefined;
  const respondingHere = Boolean(activeGeneration);

  useEffect(() => {
    if (conversationId) void onRead(conversationId);
  }, [conversationId, onRead]);

  useEffect(() => {
    const history = historyRef.current;
    if (!history || !conversationId) return;
    restoringScrollRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const rawStored = window.localStorage.getItem(`${scrollStorageKeyPrefix}${conversationId}`);
      const stored = Number(rawStored);
      const hasStoredPosition = rawStored !== null && Number.isFinite(stored) && stored >= 0;
      history.scrollTop = hasStoredPosition ? Math.min(stored, history.scrollHeight) : history.scrollHeight;
      stickToBottomRef.current = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
      restoringScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationId, scrollStorageKeyPrefix]);

  useEffect(() => {
    const history = historyRef.current;
    if (!history || restoringScrollRef.current || !stickToBottomRef.current) return;
    history.scrollTo({ top: history.scrollHeight, behavior: "smooth" });
  }, [conversation?.messages.length, respondingHere]);

  if (!conversation) return <Empty />;

  const account = data.accounts.find((item) => item.id === conversation.accountId)!;
  const opportunity =
    data.opportunities.find((item) => item.id === conversation.opportunityId) ||
    data.opportunities.find((item) => item.accountId === conversation.accountId);
  if (!opportunity) return <div className="local-error">Esta conversa nao possui uma oportunidade valida.</div>;
  const product = data.products.find((item) => item.id === opportunity.primaryProductId);
  const contact =
    account.contacts.find((item) => item.id === conversation.currentContactId) ||
    account.contacts.find((item) => item.id === opportunity.currentContactId) ||
    account.contacts[0];
  if (!contact) return <div className="local-error">Esta conversa nao possui um contato valido.</div>;

  const openBatch = findOpenSellerBatch(conversation.messages);
  const waitingBatch = findWaitingSellerBatch(conversation.messages);
  const failedBatch = findFailedSellerBatch(conversation.messages);
  const activeBatchId = activeGenerations[conversation.id]?.batchId;
  const currentBatchId = activeBatchId || waitingBatch?.batchId || failedBatch?.batchId || openBatch?.batchId || "";
  const currentRequestError = currentBatchId ? generationErrors[generationKey(conversation.id, currentBatchId)] : undefined;
  const hasCurrentResponse = currentBatchId ? hasBatchResponse(conversation.messages, currentBatchId) : false;
  const currentError = !hasCurrentResponse
    ? currentRequestError?.message || (failedBatch?.batchId === currentBatchId ? "Falha tecnica ao gerar a resposta. Tente novamente." : "")
    : "";
  const simulationEnded = conversation.status === "completed";
  const showConfirmation = Boolean(!simulationEnded && openBatch && !locallyConfirmed[generationKey(conversation.id, openBatch.batchId)] && activeBatchId !== openBatch?.batchId);
  const conversationLocked = simulationEnded || respondingHere || Boolean(waitingBatch) || Boolean(failedBatch);

  const sendOne = async () => {
    const conversationId = conversation.id;
    const text = drafts[conversationId]?.trim();
    if (!text || conversationLocked) return;
    const nextBatchId = openBatch && !respondingHere ? openBatch.batchId : draftBatchIds[conversationId] || crypto.randomUUID();
    setDraftBatchIds((current) => ({ ...current, [conversationId]: nextBatchId }));
    setDrafts((current) => ({ ...current, [conversationId]: "" }));
    await onSend(conversationId, text, contact.id, "seller", nextBatchId);
  };

  const confirm = async (batchId: string) => {
    const sourceConversation = conversation;
    const conversationId = sourceConversation.id;
    const key = generationKey(conversationId, batchId);
    if (confirmLocks.current.has(key) || activeGenerations[conversationId]) return;
    confirmLocks.current.add(key);
    setLocallyConfirmed((current) => ({ ...current, [key]: true }));
    setDraftBatchIds((current) => ({ ...current, [conversationId]: crypto.randomUUID() }));
    try {
      await onConfirmBatch(conversationId, batchId);
    } finally {
      confirmLocks.current.delete(key);
    }
  };

  const selectConversation = (conversationId: string) => {
    onSelect(conversationId);
    void onRead(conversationId);
  };

  return (
    <div className="local-conversations">
      <aside>
        <h2>Conversas</h2>
        {valid.map((item) => {
          const company = data.accounts.find((accountItem) => accountItem.id === item.accountId);
          const rowClass = [item.id === conversation.id ? "active" : "", item.unread > 0 ? "unread" : ""].filter(Boolean).join(" ");
          return (
            <button className={rowClass} key={item.id} onClick={() => selectConversation(item.id)}>
              <CompanyLogo name={company?.name || "Empresa"} imageUrl={company?.logoUrl} />
              <div><b>{company?.name}</b><small>{item.messages.at(-1)?.text || "Faca sua abordagem"}</small></div>
              {item.unread > 0 && <span className="local-unread-count">{item.unread}</span>}
            </button>
          );
        })}
      </aside>
      <section>
        <header><div><b>{contact.name}</b><span>{account.name} · {contact.jobTitle}</span><strong>Servico relacionado: {product?.name || "Nao informado"}</strong></div></header>
        <div ref={historyRef} className="local-chat-history" onScroll={(event) => {
          if (!conversationId || restoringScrollRef.current) return;
          const history = event.currentTarget;
          stickToBottomRef.current = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
          try { window.localStorage.setItem(`${scrollStorageKeyPrefix}${conversationId}`, String(Math.max(0, Math.round(history.scrollTop)))); } catch { /* Scroll restoration remains optional. */ }
        }}>
          {!conversation.messages.length && <div className="local-chat-empty"><h2>Voce inicia esta conversa</h2><p>Explique claramente o motivo do contato.</p></div>}
          {conversation.messages.map((message) => (
            <div className={`local-message ${message.sender}`} key={message.id}>
              <small>{message.sender === "seller" ? "Voce" : contact.name} <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time></small>
              <p>{message.text}</p>
            </div>
          ))}
          {activeGeneration?.phase === "recovering" && <div className="lead-typing recovering">Recuperando a conversa e verificando a resposta...</div>}
          {activeGeneration?.phase === "generating" && <div className="lead-typing">{contact.name} esta respondendo...</div>}
        </div>
        {showConfirmation && openBatch && (
          <div className="message-batch-confirm">
            <div><b>Tem mais alguma coisa a ser dita?</b><span>{openBatch.count} {openBatch.count === 1 ? "mensagem pronta" : "mensagens prontas"} para chegar ao lead.</span></div>
            <button onClick={() => input.current?.focus()}>Sim, escrever mais</button>
            <button className="primary" onClick={() => confirm(openBatch.batchId)}>Nao, enviar ao lead</button>
          </div>
        )}
        <div className="local-chat-compose">
          <textarea
            ref={input}
            value={drafts[conversation.id] || ""}
            disabled={conversationLocked}
            onChange={(event) => setDrafts((current) => ({ ...current, [conversation.id]: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendOne();
              }
            }}
            placeholder={simulationEnded ? "Esta simulacao foi encerrada." : activeGeneration?.phase === "recovering" ? "Aguarde enquanto recuperamos a conversa..." : currentError ? "A geracao falhou. Use Tentar novamente." : conversationLocked ? "Aguarde enquanto o lead responde..." : "Escreva sua mensagem..."}
          />
          <button className="primary" disabled={conversationLocked || !drafts[conversation.id]?.trim()} onClick={sendOne}>Enviar ↑</button>
        </div>
        {!simulationEnded && conversation.messages.length >= 2 && <div className="simulation-finish"><span><b>Concluiu este treino?</b> Finalize quando tiver conduzido a conversa até o ponto desejado.</span><button onClick={() => { if (window.confirm("Finalizar esta simulação e liberar a avaliação?")) void onFinalize(conversation.id); }}>Finalizar simulação</button></div>}
        {simulationEnded && <div className="simulation-ended"><span><b>Simulação encerrada</b> Veja o que funcionou e como melhorar sua próxima abordagem.</span><div><button className="evaluation-button" disabled={evaluatingConversationId === conversation.id} onClick={() => void onEvaluate(conversation.id)}>{evaluatingConversationId === conversation.id ? "Avaliando conversa…" : "Ver avaliação e feedback"}</button><button onClick={onStartAnother}>Iniciar outra simulação</button></div></div>}
        {currentError && currentBatchId && !hasCurrentResponse && <div className="recoverable-error"><span>{currentError}</span><button disabled={respondingHere} onClick={() => confirm(currentBatchId)}>Tentar novamente</button></div>}
      </section>
      <LeadSidePanel data={data} account={account} conversation={conversation} />
    </div>
  );
}

function LeadSidePanel({ data, account, conversation }: { data: LocalData; account: LocalAccount; conversation: LocalData["conversations"][number] }) {
  const opportunity =
    data.opportunities.find((item) => item.id === conversation.opportunityId) ||
    data.opportunities.find((item) => item.accountId === conversation.accountId);
  const product = data.products.find((item) => item.id === opportunity?.primaryProductId);
  const contact =
    account.contacts.find((item) => item.id === conversation.currentContactId) ||
    account.contacts.find((item) => item.id === opportunity?.currentContactId) ||
    account.contacts[0];
  const conversationSummary = summarizeConversation(conversation.messages);
  const leadMentions = summarizeLeadMentions(conversation.messages);
  const investigation = [
    ...(opportunity?.discoveredFacts || []),
    ...(product?.qualificationQuestions || []).map((question) => `Investigar: ${question}`),
  ];

  return (
    <aside className="conversation-lead-summary">
      <p className="eyebrow">FICHA LATERAL</p>
      <h2>{account.name}</h2>
      <section><h3>Contato</h3><p><b>{contact?.name || "Nao informado"}</b><br />{contact?.jobTitle || "Nao informado"} · {account.segment || "Nao informado"}</p><small>{roleLabel(contact?.buyingRole)} · Autonomia: {autonomyLabel(contact?.decisionPower)}</small></section>
      <section><h3>Empresa</h3><p>{account.story || account.context || "Nao informado"}</p><small>Operacao: {account.context || "Nao informado"}</small></section>
      <section><h3>Servico relacionado</h3><b>{product?.name || "Nao informado"}</b><small>{product?.description || product?.problemSolved || "Nao informado"}</small></section>
      <section><h3>Presenca digital e canais</h3><p>{findDigitalPresence(account, opportunity) || "Nao informado"}</p></section>
      <section><h3>Contexto da prospeccao</h3><p>{opportunity?.source || "Nao informado"}. Hipotese: {opportunity?.possibleApplication || "Nao informado"}</p></section>
      <section><h3>Ficha inicial</h3><p>Necessidade conhecida: {opportunity?.need || account.knownProblem || "Nao informado"}</p><p>Proxima acao sugerida: {opportunity?.nextAction || "Nao informado"}</p></section>
      <section><h3>Descobertas da conversa</h3><p>{conversationSummary}</p><p>{leadMentions}</p></section>
      <section><h3>A investigar</h3>{investigation.length ? investigation.slice(0, 5).map((item) => <p key={item}>{item}</p>) : <p>Nao informado</p>}</section>
      <section><h3>Mapa de decisao</h3>{account.contacts.map((item) => <p key={item.id}>{item.visibility === "known" ? `${item.name} · ${item.jobTitle} · ${roleLabel(item.buyingRole)}` : item.buyingRole === "decision_maker" ? "Decisor nao identificado" : "Contato nao identificado"}</p>)}</section>
    </aside>
  );
}

function Empty() {
  return (
    <>
      <div className="local-title"><div><p className="eyebrow">CAIXA DE ENTRADA</p><h1>Conversas</h1><p>As abordagens iniciadas na aba Leads aparecerao aqui.</p></div></div>
      <div className="local-empty"><h2>Nenhuma conversa iniciada</h2><p>Abra um lead e clique em Iniciar conversa.</p></div>
    </>
  );
}

function findOpenSellerBatch(messages: LocalMessage[]) {
  const trailing = trailingSellerMessages(messages).filter((message) => !message.status || message.status === "sent");
  const batchId = trailing.at(-1)?.batchId;
  if (!batchId) return null;
  const count = trailing.filter((message) => message.batchId === batchId).length;
  return count > 0 ? { batchId, count } : null;
}

function findFailedSellerBatch(messages: LocalMessage[]) {
  const batchId = trailingSellerMessages(messages).find((message) => message.status === "failed")?.batchId;
  return batchId ? { batchId } : null;
}

function findWaitingSellerBatch(messages: LocalMessage[]) {
  const message = trailingSellerMessages(messages).find((item) => item.status === "waiting");
  return message?.batchId ? { batchId: message.batchId } : null;
}

function trailingSellerMessages(messages: LocalMessage[]) {
  const result: LocalMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender === "system") continue;
    if (message.sender !== "seller") break;
    result.unshift(message);
  }
  return result;
}

function summarizeConversation(messages: LocalMessage[]) {
  const relevant = messages.filter((message) => message.sender !== "system").slice(-4);
  if (!relevant.length) return "Nada conversado ainda.";
  return relevant.map((message) => `${message.sender === "seller" ? "Vendedor" : "Lead"}: ${message.text}`).join(" ");
}

function summarizeLeadMentions(messages: LocalMessage[]) {
  const leadMessages = messages
    .filter((message) => message.sender === "contact")
    .filter((message) => /\b(preciso|nao|não|duvida|dúvida|preco|preço|prazo|equipe|reuniao|reunião|proposta|orcamento|orçamento|decis)/i.test(message.text))
    .slice(-3);
  if (!leadMessages.length) return "Necessidades, objecoes e proximos passos mencionados pelo lead: ainda nao informados.";
  return `Mencionado pelo lead: ${leadMessages.map((message) => message.text).join(" ")}`;
}

function findDigitalPresence(account: LocalAccount, opportunity: NonNullable<LocalData["opportunities"][number]> | undefined) {
  const text = `${account.story} ${account.context} ${account.knownProblem} ${opportunity?.need || ""} ${opportunity?.possibleApplication || ""}`;
  const matches = text.match(/\b(site|redes sociais|instagram|whatsapp|e-commerce|loja virtual|telefone|formulario|formulário|canais fisicos|canais físicos)\b/gi);
  return matches ? [...new Set(matches.map((item) => item.toLowerCase()))].join(", ") : "";
}

function roleLabel(role?: string) {
  return ({
    gatekeeper: "Atendente/gatekeeper",
    user: "Usuario",
    influencer: "Gerente/influenciador",
    champion: "Apoiador interno",
    technical_evaluator: "Avaliador tecnico",
    financial_approver: "Aprovador financeiro",
    decision_maker: "Proprietario/decisor",
    executive_sponsor: "Patrocinador executivo",
  }[role || ""] || role || "Nao informado");
}

function autonomyLabel(value?: number) {
  if (typeof value !== "number") return "Nao informado";
  if (value >= 4) return "alta";
  if (value >= 2) return "media";
  return "baixa";
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function CompanyLogo({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const hue = [...name].reduce((value, character) => value + character.charCodeAt(0), 0) % 360;
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="company-logo" style={{ "--logo-hue": hue } as React.CSSProperties}>{imageUrl ? <img src={imageUrl} alt={`Logo da ${name}`} /> : name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>;
}
