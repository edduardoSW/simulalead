import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("models a multi-contact buying committee without exposing unknown contacts", async () => {
  const [migration, leads, api, context] = await Promise.all([
    readFile(new URL("supabase/migrations/202609050002_b2b_buying_committee.sql", root), "utf8"),
    readFile(new URL("lib/leads.ts", root), "utf8"),
    readFile(new URL("app/api/simulate/route.ts", root), "utf8"),
    readFile(new URL("lib/simulation-context.ts", root), "utf8"),
  ]);
  for (const table of ["simulated_accounts", "simulated_contacts", "conversation_participants", "contact_handoffs", "organization_invitations"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
  }
  assert.match(migration, /case when cp\.status='unknown' then null else c\.name end/);
  assert.match(migration, /force row level security/g);
  assert.match(leads, /buyingRole:"gatekeeper"/);
  assert.match(leads, /buyingRole:"decision_maker"/);
  assert.match(`${api}\n${context}`, /gatekeeper só encaminha/i);
  assert.match(`${api}\n${context}`, /Nao revele o mapa interno completo|não revele o mapa interno completo/i);
});

test("uses Supabase exclusively without a local database fallback", async () => {
  const [page, repository, workspace] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/supabase-repository.ts", root), "utf8"),
    readFile(new URL("components/LocalWorkspace.tsx", root), "utf8"),
  ]);
  assert.match(page, /<SupabaseWorkspace/);
  assert.match(repository, /workspace_states/);
  assert.doesNotMatch(workspace, /IndexedDbRepository|sessionStorage|MODO LOCAL|AMBIENTE LOCAL/);
});
