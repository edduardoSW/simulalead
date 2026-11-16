/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyLocalData, type LocalData } from "../lib/local-domain";
import {
  generationKey,
  hasBatchResponse,
  isCurrentGeneration,
  reconcileGenerationErrors,
  type ActiveGeneration,
  type GenerationErrors,
} from "../lib/generation-state";
import type { LocalRepository } from "../lib/local-repository";
import { LocalApplicationService } from "../lib/local-service";
import { supabase } from "../lib/supabase-client";
import { pathForSection, readLastWorkspaceLocation, resolveWorkspaceLocation, saveLastWorkspaceLocation, sectionFromPath, workspaceRoutes, type WorkspaceSection } from "../lib/workspace-routes";
import { LoadingScreen, StartupErrorScreen } from "./AppFallbacks";
import { LocalLeads } from "./LocalLeads";
import { LocalConversations } from "./LocalConversations";
import { LocalTrainings } from "./LocalTrainings";
import { SupabaseTeamManagement } from "./LocalAuth";
import { GeminiUsagePanel } from "./GeminiUsagePanel";
import { evaluationCriteriaLabels } from "../lib/gemini-evaluation";

type Profile = { id: string; organization_id: string; role: string };
type Sender = "seller" | "contact";
type InternalNotification = { id: string; conversationId: string; messageId: string; contact: string; company: string; preview: string };
type SimulationApiResult = { status?: "processing" | "completed" | "failed" | "interrupted"; text?: string; ended?: boolean; error?: string; retryable?: boolean; conversationId?: string; batchId?: string; requestId?: string; retryAfterSeconds?: number };
type EvaluationApiResult = { evaluation?: LocalData["evaluations"][number]; error?: string; retryAfterSeconds?: number };

const leadGenerationClientTimeoutMs = 75_000;

export function LocalWorkspace({ repository, profile, initialSection, onLogout }: { repository: LocalRepository; profile: Profile; initialSection: WorkspaceSection; onLogout: () => void }) {
  const service = useMemo(() => new LocalApplicationService(repository), [repository]);
  return <LocalWorkspaceInner service={service} profile={profile} initialSection={initialSection} onLogout={onLogout} />;
}

function LocalWorkspaceInner({ service, profile, initialSection, onLogout }: { service: LocalApplicationService; profile: Profile; initialSection: WorkspaceSection; onLogout: () => void }) {
  const [data, setData] = useState<LocalData>(emptyLocalData());
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<WorkspaceSection>(initialSection);
  const [error, setError] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [selectedTrainingId, setSelectedTrainingId] = useState("");
  const [activeGenerations, setActiveGenerations] = useState<Record<string, ActiveGeneration>>({});
  const [generationErrors, setGenerationErrors] = useState<GenerationErrors>({});
  const [evaluatingConversationId, setEvaluatingConversationId] = useState("");
  const [notifications, setNotifications] = useState<InternalNotification[]>([]);
  const dataRef = useRef(data);
  const sectionRef = useRef(section);
  const selectedConversationRef = useRef(selectedConversationId);
  const selectedTrainingRef = useRef(selectedTrainingId);
  const activeGenerationRef = useRef(new Map<string, ActiveGeneration>());
  const completedBatchesRef = useRef(new Set<string>());
  const recoveryStartedRef = useRef(new Set<string>());
  const evaluationLocksRef = useRef(new Set<string>());

  const commitData = useCallback((next: LocalData) => {
    dataRef.current = next;
    setData(next);
  }, []);

  useEffect(() => { sectionRef.current = section; }, [section]);
  useEffect(() => { selectedConversationRef.current = selectedConversationId; }, [selectedConversationId]);
  useEffect(() => { selectedTrainingRef.current = selectedTrainingId; }, [selectedTrainingId]);
  useEffect(() => setSection(initialSection), [initialSection]);
  useEffect(() => {
    const handle = () => {
      const scope = {
        conversationIds: new Set(dataRef.current.conversations.map((conversation) => conversation.id)),
        scenarioIds: new Set(dataRef.current.scenarios.map((scenario) => scenario.id)),
      };
      let location = resolveWorkspaceLocation(`${window.location.pathname}${window.location.search}`, null, scope);
      const next = sectionFromPath(location);
      if (next) {
        setSection(next);
        if (next === "conversations") {
          const conversationId = new URL(location, window.location.origin).searchParams.get("conversation") || dataRef.current.conversations[0]?.id;
          if (conversationId) {
            setSelectedConversationId(conversationId);
            selectedConversationRef.current = conversationId;
            location = `${pathForSection("conversations")}?conversation=${encodeURIComponent(conversationId)}`;
          }
        }
        if (next === "scenarios") {
          const scenarioId = new URL(location, window.location.origin).searchParams.get("training") || "";
          setSelectedTrainingId(scenarioId);
          selectedTrainingRef.current = scenarioId;
        }
        if (`${window.location.pathname}${window.location.search}` !== location) window.history.replaceState(null, "", location);
        saveLastWorkspaceLocation(window.localStorage, profile.id, location);
      }
    };
    window.addEventListener("popstate", handle);
    return () => window.removeEventListener("popstate", handle);
  }, [profile.id]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    console.info("[simulaLEAD] Carregando dados do workspace.");
    service.loadAndUpgradeTemplates().then((next) => {
      if (!active) return;
      if (!next.organization) {
        console.error("[simulaLEAD] Dados do workspace sem organizacao.", { keys: Object.keys(next) });
        setError("Os dados da organizacao nao foram encontrados.");
        commitData(next);
        return;
      }
      commitData(next);
      const scope = {
        conversationIds: new Set(next.conversations.map((conversation) => conversation.id)),
        scenarioIds: new Set(next.scenarios.map((scenario) => scenario.id)),
      };
      const currentLocation = `${window.location.pathname}${window.location.search}`;
      const savedLocation = readLastWorkspaceLocation(window.localStorage, profile.id);
      let restoredLocation = resolveWorkspaceLocation(currentLocation, savedLocation, scope);
      const restoredSection = sectionFromPath(restoredLocation) || "home";
      const restoredParams = new URL(restoredLocation, window.location.origin).searchParams;
      const requestedConversationId = restoredParams.get("conversation");
      const selected = next.conversations.some((conversation) => conversation.id === requestedConversationId)
        ? requestedConversationId!
        : next.conversations[0]?.id || "";
      if (restoredSection === "conversations" && selected) restoredLocation = `${pathForSection("conversations")}?conversation=${encodeURIComponent(selected)}`;
      const requestedTrainingId = restoredParams.get("training");
      const selectedTraining = next.scenarios.some((scenario) => scenario.id === requestedTrainingId) ? requestedTrainingId! : "";
      setSection(restoredSection);
      setSelectedConversationId(selected);
      selectedConversationRef.current = selected;
      setSelectedTrainingId(selectedTraining);
      selectedTrainingRef.current = selectedTraining;
      if (`${window.location.pathname}${window.location.search}` !== restoredLocation) window.history.replaceState(null, "", restoredLocation);
      saveLastWorkspaceLocation(window.localStorage, profile.id, restoredLocation);
      for (const conversation of next.conversations) {
        for (const message of conversation.messages) {
          if (message.sender === "contact" && message.batchId) completedBatchesRef.current.add(`${conversation.id}:${message.batchId}`);
        }
      }
      console.info("[simulaLEAD] Dados do workspace carregados.", { organizationId: next.organization.id, accounts: next.accounts.length, opportunities: next.opportunities.length });
    }).catch((cause) => {
      if (!active) return;
      const message = cause instanceof Error ? cause.message : "Falha ao carregar dados do workspace.";
      console.error("[simulaLEAD] Falha ao carregar dados do workspace.", cause);
      setError(message);
      commitData(emptyLocalData());
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [service, commitData, profile.id]);

  const navigate = useCallback((next: WorkspaceSection) => {
    setSection(next);
    const basePath = pathForSection(next);
    const path = next === "conversations" && selectedConversationRef.current
      ? `${basePath}?conversation=${encodeURIComponent(selectedConversationRef.current)}`
      : next === "scenarios" && selectedTrainingRef.current
        ? `${basePath}?training=${encodeURIComponent(selectedTrainingRef.current)}`
      : basePath;
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState(null, "", path);
    saveLastWorkspaceLocation(window.localStorage, profile.id, path);
  }, [profile.id]);

  const markConversationRead = useCallback(async (conversationId: string) => {
    const current = dataRef.current.conversations.find((conversation) => conversation.id === conversationId);
    if (!current || current.unread === 0) return;
    const next = await service.markConversationRead(conversationId);
    commitData(next);
  }, [service, commitData]);

  const selectConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId);
    selectedConversationRef.current = conversationId;
    if (sectionRef.current === "conversations") {
      const path = `${pathForSection("conversations")}?conversation=${encodeURIComponent(conversationId)}`;
      if (`${window.location.pathname}${window.location.search}` !== path) window.history.replaceState(null, "", path);
      saveLastWorkspaceLocation(window.localStorage, profile.id, path);
    }
  }, [profile.id]);

  const selectTraining = useCallback((scenarioId: string) => {
    setSelectedTrainingId(scenarioId);
    selectedTrainingRef.current = scenarioId;
    if (sectionRef.current !== "scenarios") return;
    const basePath = pathForSection("scenarios");
    const path = scenarioId ? `${basePath}?training=${encodeURIComponent(scenarioId)}` : basePath;
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.replaceState(null, "", path);
    saveLastWorkspaceLocation(window.localStorage, profile.id, path);
  }, [profile.id]);

  const openConversation = useCallback((conversationId: string) => {
    selectConversation(conversationId);
    navigate("conversations");
    void markConversationRead(conversationId);
  }, [markConversationRead, navigate, selectConversation]);

  const addMessage = useCallback(async (id: string, text: string, contactId?: string, sender: Sender = "seller", batchId?: string, requestId?: string) => {
    const next = await service.addMessage(id, { sender, text, contactId, batchId, requestId });
    commitData(next);
  }, [service, commitData]);

  const clearBatchError = useCallback((conversationId: string, batchId: string) => {
    const key = generationKey(conversationId, batchId);
    setGenerationErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const syncBatchFromPersistence = useCallback(async (conversationId: string, batchId: string) => {
    const next = await service.load();
    commitData(next);
    const conversation = next.conversations.find((item) => item.id === conversationId);
    if (!conversation || !hasBatchResponse(conversation.messages, batchId)) return false;
    completedBatchesRef.current.add(generationKey(conversationId, batchId));
    clearBatchError(conversationId, batchId);
    return true;
  }, [clearBatchError, commitData, service]);

  const finishOperation = useCallback((conversationId: string, operationId: string) => {
    if (!isCurrentGeneration(activeGenerationRef.current, conversationId, operationId)) return;
    activeGenerationRef.current.delete(conversationId);
    setActiveGenerations((current) => {
      if (current[conversationId]?.operationId !== operationId) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const recoverBatch = useCallback(async (conversationId: string, batchId: string, requestId: string, initialPhase: ActiveGeneration["phase"] = "recovering") => {
    const key = generationKey(conversationId, batchId);
    if (completedBatchesRef.current.has(key)) return true;
    const operationId = crypto.randomUUID();
    const activeGeneration: ActiveGeneration = { batchId, requestId, operationId, phase: initialPhase };
    activeGenerationRef.current.set(conversationId, activeGeneration);
    setActiveGenerations((current) => ({ ...current, [conversationId]: activeGeneration }));
    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const accessToken = await getAccessToken();
        const response = await fetchWithTimeout(`/api/simulate?conversationId=${encodeURIComponent(conversationId)}&batchId=${encodeURIComponent(batchId)}`, {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}` },
        }, 15_000);
        const result = await readSimulationResponse(response);
        if (response.ok && result.status === "completed") {
          if (await syncBatchFromPersistence(conversationId, batchId)) return true;
          throw new Error("A resposta foi concluida, mas ainda nao pôde ser sincronizada. Tente recuperar novamente.");
        }
        if (response.status === 202 && result.status === "processing") {
          if (!isCurrentGeneration(activeGenerationRef.current, conversationId, operationId)) return false;
          const generating: ActiveGeneration = { batchId, requestId: result.requestId || requestId, operationId, phase: "generating" };
          activeGenerationRef.current.set(conversationId, generating);
          setActiveGenerations((current) => current[conversationId]?.operationId === operationId ? { ...current, [conversationId]: generating } : current);
          await delay(2_000);
          continue;
        }
        if (response.status === 401) throw new Error("Sua sessao expirou. Entre novamente para continuar.");
        if (response.status === 404 && result.status === "interrupted") {
          if (await syncBatchFromPersistence(conversationId, batchId)) return true;
          const next = await service.updateBatchStatus(conversationId, batchId, "failed", requestId);
          commitData(next);
          throw new Error("A resposta foi interrompida durante a recarga. Sua mensagem foi preservada; tente novamente.");
        }
        if (response.status === 409 && result.status === "failed" && await syncBatchFromPersistence(conversationId, batchId)) return true;
        throw new Error(formatSimulationError(result));
      }
      throw new Error("A resposta continua em processamento. Tente recuperar novamente em alguns instantes.");
    } catch (cause) {
      try {
        if (await syncBatchFromPersistence(conversationId, batchId)) return true;
      } catch { /* Keep the recoverable error when persistence is unavailable. */ }
      if (!isCurrentGeneration(activeGenerationRef.current, conversationId, operationId)) return false;
      const message = cause instanceof Error ? cause.message : "Falha tecnica ao recuperar a resposta.";
      setGenerationErrors((current) => ({
        ...current,
        [key]: { conversationId, batchId, requestId, message },
      }));
      return false;
    } finally {
      finishOperation(conversationId, operationId);
    }
  }, [commitData, finishOperation, service, syncBatchFromPersistence]);

  const confirmBatch = useCallback(async (conversationId: string, batchId: string) => {
    const key = generationKey(conversationId, batchId);
    if (completedBatchesRef.current.has(key) || activeGenerationRef.current.has(conversationId)) return;
    const requestId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    recoveryStartedRef.current.add(key);
    const activeGeneration: ActiveGeneration = { batchId, requestId, operationId, phase: "recovering" };
    activeGenerationRef.current.set(conversationId, activeGeneration);
    setActiveGenerations((current) => ({ ...current, [conversationId]: activeGeneration }));
    clearBatchError(conversationId, batchId);

    try {
      const existing = dataRef.current.conversations.find((conversation) => conversation.id === conversationId);
      if (existing && hasBatchResponse(existing.messages, batchId)) {
        completedBatchesRef.current.add(key);
        return;
      }

      const accessToken = await getAccessToken();
      const statusResponse = await fetchWithTimeout(`/api/simulate?conversationId=${encodeURIComponent(conversationId)}&batchId=${encodeURIComponent(batchId)}`, {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }, 15_000);
      const statusResult = await readSimulationResponse(statusResponse);
      if (statusResponse.ok && statusResult.status === "completed") {
        if (await syncBatchFromPersistence(conversationId, batchId)) return;
        throw new Error("A resposta concluida ainda nao pôde ser sincronizada.");
      }
      if (statusResponse.status === 202 && statusResult.status === "processing") {
        await recoverBatch(conversationId, batchId, statusResult.requestId || requestId, "generating");
        return;
      }
      if (statusResponse.status === 401) throw new Error("Sua sessao expirou. Entre novamente para continuar.");
      if (statusResponse.status >= 500) throw new Error(formatSimulationError(statusResult));

      if (!isCurrentGeneration(activeGenerationRef.current, conversationId, operationId)) return;
      const generating: ActiveGeneration = { batchId, requestId, operationId, phase: "generating" };
      activeGenerationRef.current.set(conversationId, generating);
      setActiveGenerations((current) => current[conversationId]?.operationId === operationId ? { ...current, [conversationId]: generating } : current);
      const waitingData = await service.updateBatchStatus(conversationId, batchId, "waiting", requestId);
      commitData(waitingData);
      const response = await fetchWithTimeout("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ conversationId, batchId, requestId }),
      }, leadGenerationClientTimeoutMs);
      const result = await readSimulationResponse(response);
      if (response.status === 202 && result.status === "processing") {
        await recoverBatch(conversationId, batchId, result.requestId || requestId, "generating");
        return;
      }
      if (!response.ok || !result.text) throw new Error(formatSimulationError(result));
      if (result.conversationId && result.conversationId !== conversationId) throw new Error("A resposta recebida pertencia a outra conversa.");
      if (result.batchId && result.batchId !== batchId) throw new Error("A resposta recebida pertencia a outro lote.");
      if (!await syncBatchFromPersistence(conversationId, batchId)) throw new Error("A resposta foi gerada, mas ainda nao pôde ser sincronizada.");
      if (sectionRef.current === "conversations" && selectedConversationRef.current === conversationId) await markConversationRead(conversationId);
    } catch (cause) {
      try {
        if (await syncBatchFromPersistence(conversationId, batchId)) return;
      } catch { /* Preserve the current conversation when the backend is unavailable. */ }
      if (!isCurrentGeneration(activeGenerationRef.current, conversationId, operationId)) return;
      const message = cause instanceof Error ? cause.message : "Falha tecnica ao gerar a resposta.";
      setGenerationErrors((current) => ({
        ...current,
        [key]: { conversationId, batchId, requestId, message },
      }));
    } finally {
      finishOperation(conversationId, operationId);
    }
  }, [clearBatchError, commitData, finishOperation, markConversationRead, recoverBatch, service, syncBatchFromPersistence]);

  useEffect(() => {
    if (loading) return;
    for (const conversation of data.conversations) {
      const pending = findPendingSellerBatch(conversation.messages);
      if (!pending) continue;
      const key = `${conversation.id}:${pending.batchId}`;
      if (recoveryStartedRef.current.has(key)) continue;
      recoveryStartedRef.current.add(key);
      void recoverBatch(conversation.id, pending.batchId, pending.requestId || "", "recovering");
    }
  }, [data.conversations, loading, recoverBatch]);

  useEffect(() => {
    setGenerationErrors((current) => reconcileGenerationErrors(current, data.conversations));
  }, [data.conversations]);

  const finishConversation = useCallback(async (conversationId: string) => {
    try {
      const next = await service.finishConversation(conversationId);
      commitData(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao foi possivel finalizar a simulacao.");
    }
  }, [commitData, service]);

  const evaluateConversation = useCallback(async (conversationId: string) => {
    const existing = dataRef.current.evaluations.find((item) => item.conversationId === conversationId);
    if (existing) { navigate("evaluations"); return; }
    if (evaluationLocksRef.current.has(conversationId)) return;
    evaluationLocksRef.current.add(conversationId);
    setEvaluatingConversationId(conversationId);
    setError("");
    try {
      const accessToken = await getAccessToken();
      const request = await fetchWithTimeout("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ conversationId, requestId: crypto.randomUUID() }),
      }, 55_000);
      const result = await request.json().catch(() => ({ error: "Resposta inválida da avaliação." })) as EvaluationApiResult;
      if (!request.ok || !result.evaluation) throw new Error(result.error || "Nao foi possivel gerar a avaliacao.");
      const next = await service.load();
      if (!next.evaluations.some((item) => item.conversationId === conversationId)) {
        throw new Error("A avaliação não foi confirmada no histórico. Tente novamente.");
      }
      commitData(next);
      navigate("evaluations");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao foi possivel gerar a avaliacao.");
    } finally {
      evaluationLocksRef.current.delete(conversationId);
      setEvaluatingConversationId("");
    }
  }, [commitData, navigate, service]);

  if (loading) return <LoadingScreen text="Carregando dados" />;
  if (!data.organization) return <StartupErrorScreen title="Workspace indisponivel" message={error || "Nao encontramos os dados necessarios para abrir a organizacao."} onAction={() => window.location.reload()} />;

  const orgName = data.organization.name || "Workspace";
  return (
    <main className="local-shell">
      <aside className="local-nav">
        <div className="brand"><span className="brand-mark">S</span><span>simulaLEAD</span></div>
        <div className="local-org"><span>{orgName.slice(0, 2).toUpperCase()}</span><div><small>Workspace</small><b>{orgName}</b></div></div>
        <nav>{workspaceRoutes.map(({ section: id, label }) => <button key={id} className={section === id ? "active" : ""} onClick={() => navigate(id)}>{label}<b>{count(id, data) || ""}</b></button>)}</nav>
        <div className="local-nav-footer"><button className="logout-button" onClick={onLogout}>Sair</button></div>
      </aside>
      <section className="local-content">
        <header><span>Workspace</span><b>{workspaceRoutes.find((item) => item.section === section)?.label}</b><i aria-hidden="true" /></header>
        <div className="local-page">
          {error && <div className="local-error">{error}</div>}
          <Content
            section={section}
            data={data}
            service={service}
            setData={commitData}
            navigate={navigate}
            setError={setError}
            profile={profile}
            selectedConversationId={selectedConversationId}
            selectedTrainingId={selectedTrainingId}
            activeGenerations={activeGenerations}
            generationErrors={generationErrors}
            evaluatingConversationId={evaluatingConversationId}
            onSelectConversation={selectConversation}
            onSelectTraining={selectTraining}
            onReadConversation={markConversationRead}
            onSendMessage={addMessage}
            onConfirmBatch={confirmBatch}
            onFinalizeConversation={finishConversation}
            onEvaluateConversation={evaluateConversation}
          />
        </div>
      </section>
      {notifications.length > 0 && (
        <div className="internal-notifications">
          {notifications.map((notification) => (
            <button key={notification.id} onClick={() => { setNotifications((current) => current.filter((item) => item.id !== notification.id)); openConversation(notification.conversationId); }}>
              <span>!</span>
              <div><b>{notification.contact}</b><small>{notification.company} · {notification.preview.slice(0, 90)}</small></div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

function Content({
  section,
  data,
  service,
  setData,
  navigate,
  setError,
  profile,
  selectedConversationId,
  selectedTrainingId,
  activeGenerations,
  generationErrors,
  evaluatingConversationId,
  onSelectConversation,
  onSelectTraining,
  onReadConversation,
  onSendMessage,
  onConfirmBatch,
  onFinalizeConversation,
  onEvaluateConversation,
}: {
  section: WorkspaceSection;
  data: LocalData;
  service: LocalApplicationService;
  setData: (data: LocalData) => void;
  navigate: (section: WorkspaceSection) => void;
  setError: (value: string) => void;
  profile: Profile;
  selectedConversationId: string;
  selectedTrainingId: string;
  activeGenerations: Record<string, ActiveGeneration>;
  generationErrors: GenerationErrors;
  evaluatingConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  onSelectTraining: (scenarioId: string) => void;
  onReadConversation: (conversationId: string) => Promise<void>;
  onSendMessage: (id: string, text: string, contactId?: string, sender?: Sender, batchId?: string, requestId?: string) => Promise<void>;
  onConfirmBatch: (conversationId: string, batchId: string) => Promise<void>;
  onFinalizeConversation: (conversationId: string) => Promise<void>;
  onEvaluateConversation: (conversationId: string) => Promise<void>;
}) {
  const organization = data.organization;
  if (section === "home") return <><Title eyebrow="VISAO GERAL" title={`Ola, ${organization?.ownerName || "time"}.`} text="Treine vendas de projetos de TI com oportunidades completas." /><div className="real-metrics"><Stat value={data.opportunities.length} label="Oportunidades" /><Stat value={data.conversations.length} label="Conversas" /><Stat value={data.scenarios.length} label="Treinamentos" /><Stat value={data.evaluations.length} label="Avaliacoes" /></div></>;
  if (section === "leads") return <LocalLeads data={data} onStart={async (id) => { try { const next = await service.startConversation(id, profile.id); setData(next); const started = next.conversations.find((conversation) => conversation.accountId === id && conversation.status === "active" && conversation.sellerId === profile.id); if (started) onSelectConversation(started.id); navigate("conversations"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Nao foi possivel iniciar"); } }} />;
  if (section === "opportunities") return <Opportunities data={data} onOpen={() => navigate("leads")} />;
  if (section === "conversations") return <LocalConversations data={data} selectedConversationId={selectedConversationId} scrollStorageKeyPrefix={`simulaLead:chat-scroll:${profile.id}:`} activeGenerations={activeGenerations} generationErrors={generationErrors} evaluatingConversationId={evaluatingConversationId} onSelect={onSelectConversation} onRead={onReadConversation} onSend={onSendMessage} onConfirmBatch={onConfirmBatch} onFinalize={onFinalizeConversation} onEvaluate={onEvaluateConversation} onStartAnother={() => navigate("leads")} />;
  if (section === "scenarios") return <LocalTrainings scenarios={data.scenarios} selectedScenarioId={selectedTrainingId} onSelectedScenarioChange={onSelectTraining} />;
  if (section === "evaluations") return <Evaluations data={data} onOpenConversation={(conversationId) => { onSelectConversation(conversationId); navigate("conversations"); }} />;
  return <Settings profile={profile} />;
}

function Opportunities({ data, onOpen }: { data: LocalData; onOpen: () => void }) {
  return <><Title eyebrow="PIPELINE" title="Oportunidades" text="Empresa, contato, servico e proxima acao em uma visao unica." /><div className="opportunity-table"><div className="opportunity-head"><b>Empresa e contato</b><b>Servico relacionado</b><b>Etapa</b><b>Prioridade</b><b>Proxima acao</b></div>{data.opportunities.map((opportunity) => { const account = data.accounts.find((item) => item.id === opportunity.accountId), product = data.products.find((item) => item.id === opportunity.primaryProductId), contact = account?.contacts.find((item) => item.id === opportunity.currentContactId); return <button key={opportunity.id} onClick={onOpen}><span><strong>{account?.name || "Empresa nao encontrada"}</strong><small>{contact?.name || "Contato nao informado"} · {contact?.jobTitle || "Cargo nao informado"}</small></span><b>{product?.name || "Nao informado"}</b><span>{stageLabel(opportunity.stage)}</span><i>{priorityLabel(opportunity.priority)}</i><span>{opportunity.nextAction || "Sem proxima acao"}</span></button>; })}</div></>;
}

function Settings({ profile }: { profile: Profile }) {
  return <><Title eyebrow="SUPABASE" title="Configuracoes e acesso" text="Gerencie sua equipe, permissoes e consumo da IA." /><div className="settings-cards"><SupabaseTeamManagement organizationId={profile.organization_id} isAdmin={profile.role === "admin"} /><GeminiUsagePanel /><article><h3>Privacidade</h3><p>Autenticacao pelo Supabase Auth e isolamento multiempresa por RLS.</p></article></div></>;
}

function Evaluations({ data, onOpenConversation }: { data: LocalData; onOpenConversation: (conversationId: string) => void }) {
  return <><Title eyebrow="FEEDBACK DE VENDAS" title="Avaliações" text="Feedback objetivo para transformar cada conversa em evolução prática." />{data.evaluations.length === 0 ? <Empty title="Nenhuma avaliação disponível" text="Quando uma conversa for encerrada, use o botão de avaliação para gerar seu feedback." /> : <div className="evaluation-grid">{data.evaluations.map((evaluation) => { const conversation = data.conversations.find((item) => item.id === evaluation.conversationId), account = data.accounts.find((item) => item.id === conversation?.accountId); return <article className="evaluation-card" key={evaluation.id}><header><div><p className="eyebrow">CONVERSA ANALISADA</p><h2>{account?.name || "Simulação comercial"}</h2><span>{new Date(evaluation.createdAt).toLocaleDateString("pt-BR")}{evaluation.model ? ` · ${evaluation.model}` : ""}</span></div><strong>{evaluation.score}<small>/100</small></strong></header><p className="evaluation-summary">{evaluation.summary}</p>{evaluation.criteria && <div className="evaluation-criteria">{Object.entries(evaluationCriteriaLabels).map(([key,label]) => <div key={key}><span>{label}</span><b>{evaluation.criteria?.[key as keyof typeof evaluationCriteriaLabels] ?? 0}<small>/10</small></b></div>)}</div>}<div className="evaluation-feedback"><section><h3><i aria-hidden="true">✓</i> Pontos fortes</h3>{(evaluation.strengths || ["Conversa concluída e pronta para revisão."]).map((item) => <p key={item}>{item}</p>)}</section><section><h3><i aria-hidden="true">↗</i> Para melhorar</h3>{(evaluation.improvements || ["Revise a conversa e escolha uma habilidade para praticar."]).map((item) => <p key={item}>{item}</p>)}</section></div>{evaluation.objectionAnalysis ? <div className="evaluation-recommendations"><h3>Tratamento de objeções</h3><p>{evaluation.objectionAnalysis}</p></div> : null}{evaluation.evidenceExamples?.length ? <div className="evaluation-recommendations"><h3>Evidências da conversa</h3>{evaluation.evidenceExamples.map((item) => <p key={item}>{item}</p>)}</div> : null}{evaluation.recommendations?.length ? <div className="evaluation-recommendations"><h3>Recomendações práticas</h3>{evaluation.recommendations.map((item) => <p key={item}>{item}</p>)}</div> : null}<div className="evaluation-next"><span aria-hidden="true">◎</span><div><b>Próximo treino</b><p>{evaluation.nextStep || "Pratique uma nova abordagem aplicando o feedback acima."}</p></div></div><button onClick={() => onOpenConversation(evaluation.conversationId)}>Rever conversa <span aria-hidden="true">↗</span></button></article>; })}</div>}</>;
}

const stageLabel = (stage: string) => ({ prospecting: "Prospeccao", first_contact: "Primeiro contato", initial_qualification: "Qualificacao inicial", responsible_identification: "Identificacao do responsavel", handoff: "Encaminhamento", discovery: "Descoberta", decision_mapping: "Mapa de decisao", objection_handling: "Objecoes", diagnostic_meeting: "Reuniao diagnostica", proposal: "Proposta", negotiation: "Negociacao", closed_won: "Fechada", closed_lost: "Perdida", no_response: "Sem resposta" }[stage] || stage);
const priorityLabel = (priority: string) => ({ low: "Baixa", medium: "Media", high: "Alta" }[priority] || priority);
function count(section: WorkspaceSection, data: LocalData) {
  if (section === "opportunities" || section === "leads") return data.opportunities.length;
  if (section === "conversations") return data.conversations.reduce((total, conversation) => total + conversation.unread, 0);
  if (section === "scenarios") return data.scenarios.length;
  if (section === "evaluations") return data.evaluations.length;
  return 0;
}
function delay(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Sua sessao expirou. Entre novamente para continuar.");
  return data.session.access_token;
}
function findPendingSellerBatch(messages: LocalData["conversations"][number]["messages"]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender === "system") continue;
    if (message.sender === "contact") return null;
    if (message.status === "waiting") return message.batchId ? { batchId: message.batchId, requestId: message.requestId } : null;
  }
  return null;
}
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new Error("A operação demorou demais. Tente novamente.");
    }
    throw cause;
  } finally {
    window.clearTimeout(timeout);
  }
}
async function readSimulationResponse(response: Response): Promise<SimulationApiResult> {
  try {
    return await response.json() as SimulationApiResult;
  } catch {
    return { error: "A API de simulacao retornou uma resposta invalida." };
  }
}
function formatSimulationError(result: SimulationApiResult) {
  if (result.error) return result.error;
  if (result.retryAfterSeconds) return `Limite de uso do Gemini atingido. Tente novamente em cerca de ${result.retryAfterSeconds}s.`;
  return "Nao foi possivel gerar a resposta do lead.";
}
function Title({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div className="local-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div></div>; }
function Stat({ value, label }: { value: number; label: string }) { return <article><strong>{value}</strong><span>{label}</span></article>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="local-empty"><h2>{title}</h2><p>{text}</p></div>; }
