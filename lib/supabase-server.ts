import "server-only";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "./supabase-url";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

function requiredSupabaseUrl() {
  const value = normalizeSupabaseUrl(requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"));
  if (!value) throw new Error("Variável de ambiente ausente: NEXT_PUBLIC_SUPABASE_URL");
  return value;
}

export function createAuthenticatedSupabase(accessToken: string) {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    || "";
  if (!key) throw new Error("Variável de ambiente ausente: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return createClient(requiredSupabaseUrl(), key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createAdminSupabase() {
  return createClient(
    requiredSupabaseUrl(),
    requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}
