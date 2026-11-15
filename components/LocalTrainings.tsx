"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { LocalScenario } from "../lib/local-domain";

type Message = { from: "seller" | "lead"; text: string };
type SimulationResult = { text?: string; error?: string; conversationId?: string };
type TrainingIconName = "target" | "briefcase" | "building" | "layers" | "info" | "arrow";

function TrainingIcon({ name }: { name: TrainingIconName }) {
  const paths = {
    target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /><path d="M15 9l5-5m-3 0h3v3" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" /></>,
    building: <><path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16M8 7h2m3 0h1M8 11h2m3 0h1M8 15h2m3 0h1M2 21h20" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-9h.01" /></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function initials(name?: string) {
  return (name || "Contato do treinamento").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function LocalTrainings({ scenarios }: { scenarios: LocalScenario[] }) {
  const [selected, setSelected] = useState<LocalScenario | null>(null);
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const sessionRef = useRef("");
  const retryMessagesRef = useRef<Message[]>([]);
  const modalRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const startLockRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback(() => {
    sessionRef.current = "";
    setSelected(null);
    setActive(false);
    setMessages([]);
    setDraft("");
    setError("");
    setWaiting(false);
    setStarting(false);
    startLockRef.current = false;
    retryMessagesRef.current = [];
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!selected) return;
    closeButtonRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [close, selected]);

  const start = () => {
    if (!selected || startLockRef.current) return;
    startLockRef.current = true;
    setStarting(true);
    sessionRef.current = `training:${selected.id}:${crypto.randomUUID()}`;
    setMessages([]);
    setDraft("");
    setError("");
    setActive(true);
    retryMessagesRef.current = [];
  };

  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !modalRef.current) return;
    const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
  const difficultyClass = selected?.difficulty.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  return (
    <>
      <div className="local-title"><div><p className="eyebrow">5 LEADS EXCLUSIVOS</p><h1>Treinamentos</h1><p>Personas independentes, sem vínculo com os 300 leads.</p></div></div>
      <div className="training-grid">
        {scenarios.map((scenario) => (
          <button key={scenario.id} onClick={(event) => { openerRef.current = event.currentTarget; setSelected(scenario); }}>
            <span>{scenario.difficulty}</span>
            <h2>{scenario.title}</h2>
            <p>{scenario.trainingLead?.name} · {scenario.trainingLead?.company}</p>
            <p>{scenario.objective}</p>
            <b>Abrir treinamento →</b>
          </button>
        ))}
      </div>
      {selected && (
        <div className="organization-backdrop training-backdrop" onMouseDown={close}>
          <section ref={modalRef} className="training-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={keepFocusInside} onMouseDown={(event) => event.stopPropagation()}>
            <header className="training-modal-header">
              <div className="training-heading-copy">
                <p className="eyebrow"><span aria-hidden="true" />TREINAMENTO INDEPENDENTE</p>
                <div><h2 id={titleId}>{selected.title}</h2><span className={`training-difficulty ${difficultyClass}`}>{selected.difficulty}</span></div>
              </div>
              <button ref={closeButtonRef} className="training-close" type="button" onClick={close} aria-label="Fechar treinamento">×</button>
            </header>
            {!active ? (
              <main className="training-briefing" id={descriptionId}>
                <section className="training-persona training-card training-card-enter" aria-labelledby={`${titleId}-persona`}>
                  <div className="training-avatar" aria-hidden="true">{initials(lead?.name)}</div>
                  <div className="training-persona-copy">
                    <span className="training-section-label">Perfil do cliente</span>
                    <h3 id={`${titleId}-persona`}>{lead?.name || "Contato do treinamento"}</h3>
                    <p>{lead?.jobTitle || "Cargo não informado"} <span aria-hidden="true">·</span> {lead?.company || "Empresa não informada"}</p>
                  </div>
                  <dl className="training-persona-meta">
                    <div><dt><TrainingIcon name="building" />Segmento</dt><dd>{lead?.segment || "Não informado"}</dd></div>
                    <div><dt><TrainingIcon name="layers" />Porte</dt><dd>{lead?.companySize || "Não informado"}</dd></div>
                  </dl>
                </section>

                <section className="training-mission training-card-enter" aria-labelledby={`${titleId}-mission`}>
                  <div className="training-section-icon"><TrainingIcon name="target" /></div>
                  <div><span className="training-section-label">Objetivo do treinamento</span><h3 id={`${titleId}-mission`}>Sua missão</h3><p>{selected.objective}</p></div>
                </section>

                <section className="training-context training-card training-card-enter" aria-labelledby={`${titleId}-context`}>
                  <div className="training-card-heading"><span className="training-section-icon"><TrainingIcon name="briefcase" /></span><div><span className="training-section-label">Cenário comercial</span><h3 id={`${titleId}-context`}>Contexto da negociação</h3></div></div>
                  <dl>
                    <div><dt>Serviço</dt><dd>{lead?.service || "Projeto de TI"}</dd></div>
                    <div><dt>Necessidade do cliente</dt><dd>{lead?.knownNeed || "Não informado"}</dd></div>
                  </dl>
                </section>

                <div className="training-notice training-card-enter"><span className="training-notice-icon"><TrainingIcon name="info" /></span><div><b>Ambiente de treinamento independente</b><span>Esta persona existe somente neste treinamento e não aparece nos 300 leads.</span></div></div>
                <button className="primary training-start" type="button" disabled={starting} aria-busy={starting} onClick={start}><span>{starting ? "Preparando treinamento…" : "Iniciar treinamento"}</span><TrainingIcon name="arrow" /></button>
              </main>
            ) : (
              <main className="training-practice" id={descriptionId}>
                <div className="training-messages" aria-live="polite">
                  {!messages.length && <p>Você inicia a conversa com {lead?.name}. Conduza a situação com suas próprias palavras.</p>}
                  {messages.map((message, index) => <div key={index} className={`local-message ${message.from === "seller" ? "seller" : "contact"}`}><small>{message.from === "seller" ? "Você" : lead?.name || "Contato"}</small><p>{message.text}</p></div>)}
                  {waiting && <span>{lead?.name} está respondendo...</span>}
                </div>
                <div className="local-chat-compose"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Escreva sua mensagem..." aria-label="Mensagem para o cliente" /><button className="primary" disabled={!draft.trim() || waiting} onClick={send}>Enviar ↑</button></div>
                {error && <div className="recoverable-error" role="alert"><span>{error}</span><button disabled={waiting} onClick={retry}>Tentar novamente</button></div>}
              </main>
            )}
          </section>
        </div>
      )}
    </>
  );
}
