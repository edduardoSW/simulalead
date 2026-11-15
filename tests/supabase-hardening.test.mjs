import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("saves workspace and owned simulations atomically with optimistic concurrency", async () => {
  const [migration, repository] = await Promise.all([
    readFile(new URL("supabase/migrations/202611140001_saas_hardening.sql", root), "utf8"),
    readFile(new URL("lib/supabase-repository.ts", root), "utf8"),
  ]);
  assert.match(migration, /add column if not exists version bigint/);
  assert.match(migration, /for update/);
  assert.match(migration, /errcode = '40001'/);
  assert.match(migration, /bump_user_simulation_version/);
  assert.match(migration, /requested_conversation_versions jsonb/);
  assert.match(migration, /delete from public\.user_simulations/);
  assert.match(migration, /revoke all on public\.workspace_states, public\.user_simulations, public\.simulation_generations/);
  assert.match(migration, /organization_audit_events/);
  assert.match(migration, /revoke execute on function public\.create_team_member_profile/);
  assert.match(migration, /'team_member\.deleted'/);
  assert.match(migration, /delete from auth\.users where id=member_id/);
  assert.match(repository, /rpc\("save_workspace_and_simulations"/);
  assert.match(repository, /expected_workspace_version: this\.workspaceVersion/);
  assert.match(repository, /requested_conversation_versions: Object\.fromEntries/);
  assert.match(repository, /this\.conversationVersions\.get\(conversation\.id\)/);
  assert.doesNotMatch(repository, /from\("workspace_states"\)\.upsert/);
  assert.doesNotMatch(repository, /from\("user_simulations"\)\.upsert/);
  assert.doesNotMatch(migration, /\bconversation_id\s+text;/);
  assert.match(migration, /current_conversation_id text;/);
  assert.match(migration, /s\.conversation_id = current_conversation_id/);
});

test("qualifies joined usage-view columns to avoid ambiguous SQL references", async () => {
  const migration = await readFile(new URL("supabase/migrations/202611140002_gemini_efficiency.sql", root), "utf8");
  assert.equal((migration.match(/max\(e\.created_at\) last_call_at/g) || []).length, 2);
  assert.doesNotMatch(migration, /max\(created_at\) last_call_at/);
  assert.match(migration, /left join public\.profiles p on p\.id = e\.seller_id and p\.organization_id = e\.organization_id/);
  assert.match(migration, /group by e\.organization_id, e\.seller_id, p\.full_name, e\.operation_kind/);
});

test("uses named constraints and distinct PL/pgSQL variables for conversation upserts", async () => {
  const migration = await readFile(new URL("supabase/migrations/202611150001_fix_conversation_id_ambiguity.sql", root), "utf8");
  assert.match(migration, /create or replace function public\.save_workspace_and_simulations\(/);
  assert.match(migration, /requested_conversation_versions jsonb/);
  assert.match(migration, /v_conversation_id text;/);
  assert.match(migration, /s\.conversation_id = v_conversation_id/);
  assert.match(migration, /on conflict on constraint user_simulations_pkey do update/);
  assert.match(migration, /on conflict on constraint simulation_generations_pkey do update/);
  assert.equal((migration.match(/#variable_conflict error/g) || []).length, 2);
  assert.doesNotMatch(migration, /on conflict \([^)]*conversation_id/);
});

test("reconciles Gemini evaluation usage without rewriting applied migration history", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/202611150003_reconcile_gemini_usage_schema.sql", root),
    "utf8",
  );
  assert.match(migration, /alter table public\.gemini_usage_events/);
  assert.match(migration, /add column if not exists operation_kind/);
  assert.match(migration, /create or replace function public\.record_gemini_evaluation_usage\(/);
  assert.match(migration, /#variable_conflict error/);
  assert.match(migration, /e\.conversation_id/);
  assert.match(migration, /grant execute[^]*to service_role/);
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /drop view if exists public\.gemini_usage_by_user/);
  assert.doesNotMatch(migration, /drop (table|function)/i);
});

test("moves seller evaluations out of the organization-wide workspace payload", async () => {
  const [migration, repository, route] = await Promise.all([
    readFile(new URL("supabase/migrations/202611150004_isolate_seller_evaluations.sql", root), "utf8"),
    readFile(new URL("lib/supabase-repository.ts", root), "utf8"),
    readFile(new URL("app/api/evaluate/route.ts", root), "utf8"),
  ]);
  assert.match(migration, /insert into public\.user_simulations as simulation/);
  assert.match(migration, /jsonb_set\(s\.payload, '\{evaluation\}'/);
  assert.match(migration, /evaluation\.value->>'conversationId' = s\.conversation_id/);
  assert.match(migration, /s\.conversation_id = legacy\.value->>'id'/);
  assert.match(repository, /const \{ conversations: _conversations, evaluations: _evaluations/);
  assert.match(repository, /return evaluation \? \{ \.\.\.owned, evaluation \} : owned/);
  assert.match(repository, /ownedConversationIds\.has\(evaluation\.conversationId\)/);
  assert.match(route, /simulationPayload\.evaluation/);
});

test("creates team members only through an authenticated server route with rollback", async () => {
  const [route, serverClient, component] = await Promise.all([
    readFile(new URL("app/api/team-members/route.ts", root), "utf8"),
    readFile(new URL("lib/supabase-server.ts", root), "utf8"),
    readFile(new URL("components/LocalAuth.tsx", root), "utf8"),
  ]);
  assert.match(serverClient, /import "server-only"/);
  assert.match(serverClient, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(route, /auth\.getUser\(accessToken\)/);
  assert.match(route, /caller\.role !== "admin"/);
  assert.match(route, /auth\.admin\.createUser/);
  assert.match(route, /auth\.admin\.deleteUser/);
  assert.match(route, /team_member\.created/);
  assert.match(route, /new TextEncoder\(\)\.encode\(rawBody\)/);
  assert.match(route, /recentCreations/);
  assert.match(component, /fetch\("\/api\/team-members"/);
  assert.doesNotMatch(component, /auth\.signUp/);
});

test("removes migrated legacy conversations from the shared workspace payload", async () => {
  const repository = await readFile(new URL("lib/supabase-repository.ts", root), "utf8");
  assert.match(repository, /legacyOwnerId/);
  assert.match(repository, /conversation\.sellerId !== this\.userId/);
});
