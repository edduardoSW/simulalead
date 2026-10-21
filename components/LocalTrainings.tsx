"use client";
import { useRef, useState } from "react";
import type { LocalScenario } from "../lib/local-domain";

type Message = { from: "seller" | "lead"; text: string };
type SimulationResult = { text?: string; error?: string; conversationId?: string };

export function LocalTrainings({ scenarios }: { scenarios: LocalScenario[] }) {
  const [selected, setSelected] = useState<LocalScenario | null>(null);
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const sessionRef = useRef("");
  const retryMessagesRef = useRef<Message[]>([]);

  const close = () => {
    sessionRef.current = "";
    setSelected(null);
    setActive(false);
    setMessages([]);
    setDraft("");
    setError("");
    setWaiting(false);
    retryMessagesRef.current = [];
  };

  const start = () => {
    if (!selected) return;
    sessionRef.current = `training:${selected.id}:${crypto.randomUUID()}`;
    setMessages([]);
    setDraft("");
    setError("");
    setActive(true);
    retryMessagesRef.current = [];
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !selected || waiting) return;
    const next = [...messages, { from: "seller" as const, text }];
    setMessages(next);
    setDraft("");
    retryMessagesRef.current = next;
    await requestLeadReply(next);
  };

  const retry = async () => {
    if (!selected || waiting || retryMessagesRef.current.length === 0) return;
    await requestLeadReply(retryMessagesRef.current);
  };

  const requestLeadReply = async (messageSnapshot: Message[]) => {
    if (!selected) return;
    const lead = selected.trainingLead;
    const requestSession = sessionRef.current || `training:${selected.id}`;
    const requestId = crypto.randomUUID();
    setError("");
    setWaiting(true);

    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: selected.id,
          conversationId: requestSession,
          requestId,
          scenario: { title: selected.title, desc: selected.objective },
          lead: {
            name: lead?.name || "Contato do treinamento",
            role: lead?.jobTitle || "Gestor da área",
            company: lead?.company,
            segment: lead?.segment || "Serviços",
            companySize: lead?.companySize || "Média empresa",
            problem: lead?.knownNeed || selected.objective,
            solution: lead?.service || "Projeto de TI",
            communicationStyle: lead?.style,
            visibleObjection: lead?.visibleObjection,
            hiddenConcern: lead?.hiddenConcern,
            decisionBarrier: lead?.decisionBarrier,
            difficulty: selected.difficulty,
          },
          messages: messageSnapshot,
        }),
      });
      const result = await response.json() as SimulationResult;
      if (!response.ok || !result.text) throw new Error(result.error || "Não foi possível gerar a resposta.");
      if (sessionRef.current !== requestSession || (result.conversationId && result.conversationId !== requestSession)) return;
      setMessages((current) => [...current, { from: "lead", text: result.text! }]);
    } catch (cause) {
      if (sessionRef.current === requestSession) setError(cause instanceof Error ? cause.message : "Falha técnica ao gerar a resposta.");
    } finally {
      if (sessionRef.current === requestSession) setWaiting(false);
    }
  };

  const lead = selected?.trainingLead;
  return (
    <>
      <div className="local-title"><div><p className="eyebrow">5 LEADS EXCLUSIVOS</p><h1>Treinamentos</h1><p>Personas independentes, sem vínculo com os 300 leads.</p></div></div>
      <div className="training-grid">
        {scenarios.map((scenario) => (
          <button key={scenario.id} onClick={() => setSelected(scenario)}>
            <span>{scenario.difficulty}</span>
            <h2>{scenario.title}</h2>
            <p>{scenario.trainingLead?.name} · {scenario.trainingLead?.company}</p>
            <p>{scenario.objective}</p>
            <b>Abrir treinamento →</b>
          </button>
        ))}
      </div>
      {selected && (
        <div className="organization-backdrop" onMouseDown={close}>
          <section className="training-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><p className="eyebrow">TREINAMENTO INDEPENDENTE</p><h2>{selected.title}</h2><span>{selected.difficulty}</span></div><button onClick={close}>×</button></header>
            {!active ? (
              <main>
                <div className="training-persona"><b>{lead?.name || "Contato do treinamento"}</b><span>{lead?.jobTitle} · {lead?.company}</span><small>{lead?.segment} · {lead?.companySize}</small></div>
                <h3>Objetivo</h3>
                <p>{selected.objective}</p>
                <h3>Contexto público</h3>
                <p><b>Serviço:</b> {lead?.service || "Projeto de TI"}<br /><b>Necessidade:</b> {lead?.knownNeed || "Não informado"}</p>
                <div className="training-notice"><b>Ambiente separado</b><span>Esta persona existe somente neste treinamento e não aparece nos 300 leads.</span></div>
                <button className="primary" onClick={start}>Iniciar treinamento →</button>
              </main>
            ) : (
              <main className="training-practice">
                <div className="training-messages">
                  {!messages.length && <p>Você inicia a conversa com {lead?.name}. Conduza a situação com suas próprias palavras.</p>}
                  {messages.map((message, index) => <div key={index} className={`local-message ${message.from === "seller" ? "seller" : "contact"}`}><small>{message.from === "seller" ? "Você" : lead?.name || "Contato"}</small><p>{message.text}</p></div>)}
                  {waiting && <span>{lead?.name} está respondendo...</span>}
                </div>
                <div className="local-chat-compose"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Escreva sua mensagem..." /><button className="primary" disabled={!draft.trim() || waiting} onClick={send}>Enviar ↑</button></div>
                {error && <div className="recoverable-error"><span>{error}</span><button disabled={waiting} onClick={retry}>Tentar novamente</button></div>}
              </main>
            )}
          </section>
        </div>
      )}
    </>
  );
}
