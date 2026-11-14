import { createAdminSupabase, createAuthenticatedSupabase } from "../../../lib/supabase-server";

type TeamMemberRequest = { name?: unknown; email?: unknown; password?: unknown; role?: unknown };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const roles = new Set(["admin", "manager", "seller"]);

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 16_384) return jsonError("Requisição muito grande.", 413);

  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonError("Sessão expirada.", 401);

  let body: TeamMemberRequest;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 16_384) return jsonError("Requisição muito grande.", 413);
    body = JSON.parse(rawBody) as TeamMemberRequest;
  } catch {
    return jsonError("Dados inválidos.", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (name.length < 2 || name.length > 160) return jsonError("Informe um nome válido.", 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Informe um e-mail válido.", 400);
  if (password.length < 8 || password.length > 256) return jsonError("A senha inicial deve ter entre 8 e 256 caracteres.", 400);
  if (!roles.has(role)) return jsonError("Permissão inválida.", 400);

  try {
    const authenticated = createAuthenticatedSupabase(accessToken);
    const { data: authData, error: authError } = await authenticated.auth.getUser(accessToken);
    if (authError || !authData.user) return jsonError("Sessão expirada.", 401);
    const { data: caller, error: callerError } = await authenticated
      .from("profiles")
      .select("organization_id,role,is_active")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (callerError) return jsonError("Não foi possível validar seu acesso.", 503);
    if (!caller?.is_active || caller.role !== "admin") return jsonError("Apenas administradores podem criar usuários.", 403);

    const admin = createAdminSupabase();
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCreations, error: rateError } = await admin
      .from("organization_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", caller.organization_id)
      .eq("event_type", "team_member.created")
      .gte("created_at", oneMinuteAgo);
    if (rateError) return jsonError("Não foi possível validar o limite de criação de usuários.", 503);
    if ((recentCreations || 0) >= 10) return jsonError("Muitas contas foram criadas agora. Aguarde um minuto e tente novamente.", 429);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (createError || !created.user) return jsonError(createError?.message || "Não foi possível criar o usuário.", 400);

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      organization_id: caller.organization_id,
      full_name: name,
      email,
      role,
      is_active: true,
    });
    if (profileError) {
      const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id);
      if (rollbackError) console.error("[simulaLEAD] Falha ao reverter usuário sem perfil.", { userId: created.user.id });
      return jsonError("Não foi possível vincular o usuário à organização.", 503);
    }

    const { error: auditError } = await admin.from("organization_audit_events").insert({
      organization_id: caller.organization_id,
      actor_id: authData.user.id,
      event_type: "team_member.created",
      target_user_id: created.user.id,
      metadata: { role },
    });
    if (auditError) console.error("[simulaLEAD] Falha ao auditar criação de usuário.", { userId: created.user.id });

    return Response.json({ id: created.user.id }, { status: 201 });
  } catch (error) {
    console.error("[simulaLEAD] Falha ao criar membro da equipe.", {
      error: error instanceof Error ? error.message : "Erro inesperado.",
    });
    return jsonError("O serviço de criação de usuários não está configurado.", 503);
  }
}
