import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSupabaseUrl } from "../lib/supabase-url.ts";

test("keeps a valid Supabase project URL unchanged", () => {
  assert.equal(
    normalizeSupabaseUrl("https://project.supabase.co"),
    "https://project.supabase.co",
  );
});

test("removes a REST endpoint accidentally configured as the project URL", () => {
  assert.equal(
    normalizeSupabaseUrl("https://project.supabase.co/rest/v1/"),
    "https://project.supabase.co",
  );
});

test("normalizes whitespace, trailing slashes, query and fragment", () => {
  assert.equal(
    normalizeSupabaseUrl("  https://project.supabase.co/rest/v1/?debug=true#value  "),
    "https://project.supabase.co",
  );
});
