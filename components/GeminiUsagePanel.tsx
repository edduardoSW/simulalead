"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase-client";

type UserUsage = {
  seller_id: string;
  seller_name: string;
  provider_model: string;
  provider_calls: number;
  prompt_tokens: number;
  candidate_tokens: number;
  thought_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  rate_limit_errors: number;
};

type SimulationUsage = {
  seller_id: string;
  seller_name: string;
  conversation_id: string;
  provider_model: string;
  provider_calls: number;
  total_tokens: number;
  last_quota_reason: string | null;
};

const number = new Intl.NumberFormat("pt-BR");

export function GeminiUsagePanel() {
  const [users, setUsers] = useState<UserUsage[]>([]);
  const [simulations, setSimulations] = useState<SimulationUsage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from("gemini_usage_by_user").select("seller_id,seller_name,provider_model,provider_calls,prompt_tokens,candidate_tokens,thought_tokens,cached_tokens,total_tokens,rate_limit_errors").order("total_tokens", { ascending: false }).limit(50),
      supabase.from("gemini_usage_by_simulation").select("seller_id,seller_name,conversation_id,provider_model,provider_calls,total_tokens,last_quota_reason").order("total_tokens", { ascending: false }).limit(50),
    ]).then(([userResult, simulationResult]) => {
      if (!active) return;
      const queryError = userResult.error || simulationResult.error;
      if (queryError) { setError(queryError.message); return; }
      setUsers((userResult.data || []) as UserUsage[]);
      setSimulations((simulationResult.data || []) as SimulationUsage[]);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar o consumo do Gemini.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <article className="gemini-usage-panel">
    <h3>Consumo do Gemini</h3>
    <p>Chamadas reais ao provedor. Requisições recuperadas do cache/idempotência não entram novamente.</p>
    {loading && <small>Carregando consumo…</small>}
    {error && <div className="local-error">{error}</div>}
    {!loading && !error && !users.length && <small>Nenhuma chamada registrada após a migration de métricas.</small>}
    {!!users.length && <div className="usage-table">
      <div className="usage-row usage-head"><b>Usuário</b><b>Chamadas</b><b>Entrada</b><b>Saída</b><b>Raciocínio</b><b>Total</b><b>429</b></div>
      {users.map((item) => <div className="usage-row" key={`${item.seller_id}:${item.provider_model}`}>
        <span><b>{item.seller_name}</b><small>{item.provider_model}</small></span>
        <span>{number.format(item.provider_calls)}</span><span>{number.format(item.prompt_tokens)}</span>
        <span>{number.format(item.candidate_tokens)}</span><span>{number.format(item.thought_tokens)}</span>
        <span>{number.format(item.total_tokens)}{item.cached_tokens > 0 && <small>{number.format(item.cached_tokens)} em cache</small>}</span>
        <span>{number.format(item.rate_limit_errors)}</span>
      </div>)}
    </div>}
    {!!simulations.length && <details><summary>Consumo por simulação</summary><div className="usage-table compact">
      {simulations.map((item) => <div className="usage-row" key={`${item.seller_id}:${item.conversation_id}:${item.provider_model}`}>
        <span><b>{item.seller_name}</b><small>{item.conversation_id}</small></span>
        <span>{number.format(item.provider_calls)} chamadas</span><span>{number.format(item.total_tokens)} tokens</span>
        <span>{item.last_quota_reason || "Sem erro de cota"}</span>
      </div>)}
    </div></details>}
  </article>;
}
