/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase-client";
import { PasswordInput } from "./PasswordInput";

type Member = { id: string; full_name: string; email: string | null; role: "admin" | "manager" | "seller"; is_active: boolean };

export function SupabaseTeamManagement({ organizationId, isAdmin }: { organizationId: string; isAdmin: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "seller" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const [{ data, error: loadError }, { data: userData }] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email,role,is_active").eq("organization_id", organizationId).order("created_at"),
      supabase.auth.getUser(),
    ]);
    if (loadError) { setError(loadError.message); return; }
    setMembers((data || []) as Member[]);
    setCurrentUserId(userData.user?.id || "");
  }

  useEffect(() => { void load(); }, [organizationId]);

  async function create() {
    setCreating(true);
    setError("");
    setMessage("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) { setError("Sua sessão expirou. Entre novamente."); return; }
      const request = await fetch("/api/team-members", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const result = await request.json().catch(() => ({ error: "Resposta inválida do servidor." })) as { error?: string };
      if (!request.ok) { setError(result.error || "Não foi possível criar o usuário."); return; }
      setMessage("Usuário criado com sucesso.");
      setForm({ name: "", email: "", password: "", role: "seller" });
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function manage(member: Member, changes: Partial<Pick<Member, "role" | "is_active">>) {
    setError("");
    const next = { ...member, ...changes };
    const { error: manageError } = await supabase.rpc("admin_manage_team_member", { member_id: member.id, member_role: next.role, member_active: next.is_active });
    if (manageError) { setError(manageError.message); return; }
    setMessage("Acesso atualizado.");
    await load();
  }

  async function remove(member: Member) {
    if (!confirm(`Excluir definitivamente ${member.full_name}? Esta ação não pode ser desfeita.`)) return;
    setError(""); setMessage("");
    const { error: removeError } = await supabase.rpc("admin_delete_team_member", { member_id: member.id });
    if (removeError) { setError(removeError.message); return; }
    setMessage("Usuário excluído definitivamente.");
    await load();
  }

  async function resetPassword(email: string | null) {
    if (!email) { setError("Este usuário não possui e-mail cadastrado."); return; }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (resetError) setError(resetError.message); else setMessage(`Recuperação de senha enviada para ${email}.`);
  }

  return <article className="user-management team-management" data-form-type="other">
    <h3>Gerenciar usuários</h3>
    <div className="team-member-list">{members.map((member) => <div className={`team-member ${member.is_active ? "" : "blocked"}`} key={member.id}>
      <div><b>{member.full_name}{member.id === currentUserId ? " · você" : ""}</b><small>{member.email || "E-mail não informado"}</small></div>
      <select aria-label={`Permissão de ${member.full_name}`} value={member.role} disabled={!isAdmin || member.id === currentUserId} onChange={(event) => void manage(member, { role: event.target.value as Member["role"] })}><option value="seller">Vendedor</option><option value="manager">Gestor</option><option value="admin">Administrador</option></select>
      {isAdmin && member.id !== currentUserId && <button onClick={() => void manage(member, { is_active: !member.is_active })}>{member.is_active ? "Bloquear" : "Reativar"}</button>}
      <button onClick={() => void resetPassword(member.email)}>Redefinir senha</button>
      {isAdmin && member.id !== currentUserId && <button className="delete-user" onClick={() => void remove(member)}>Excluir</button>}
    </div>)}</div>
    {isAdmin && <><h3 className="new-user-title">Novo usuário</h3><div className="autofill-trap" aria-hidden="true"><input name="username" autoComplete="username" tabIndex={-1}/><input type="password" name="password" autoComplete="current-password" tabIndex={-1}/></div>
      <label>Nome<input name="new-member-full-name" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
      <label>E-mail<input type="email" name="new-member-email" autoComplete="off" data-1p-ignore data-lpignore="true" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></label>
      <label>Senha inicial<PasswordInput name="new-member-password" autoComplete="new-password" data-1p-ignore data-lpignore="true" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo de 8 caracteres"/></label>
      <label>Permissão<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="seller">Vendedor</option><option value="manager">Gestor</option><option value="admin">Administrador</option></select></label>
      <button disabled={creating || form.name.length < 2 || !form.email || form.password.length < 8} onClick={() => void create()}>{creating ? "Criando…" : "Criar usuário"}</button></>}
    {error && <div className="local-error">{error}</div>}{message && <div className="local-success">{message}</div>}
  </article>;
}
