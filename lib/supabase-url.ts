export function normalizeSupabaseUrl(value: string | undefined) {
  const configured = value?.trim();
  if (!configured) return "";

  try {
    const url = new URL(configured);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname
      .replace(/\/rest\/v1\/?$/i, "")
      .replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return configured
      .replace(/\/rest\/v1\/?$/i, "")
      .replace(/\/+$/, "");
  }
}
