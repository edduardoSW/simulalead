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
