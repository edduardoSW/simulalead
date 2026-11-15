import assert from "node:assert/strict";
import test from "node:test";

import { generateGeminiContent, isGeminiCredentialError } from "../lib/gemini-client.ts";

test("recognizes Google AI Studio credential failures returned as HTTP 400", () => {
  assert.equal(isGeminiCredentialError(400, "API key not valid. Please pass a valid API key."), true);
  assert.equal(isGeminiCredentialError(400, "Invalid generation configuration"), false);
  assert.equal(isGeminiCredentialError(401, ""), true);
});

test("sends only the selected Gemini credential and parses retry metadata", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), key: new Headers(init.headers).get("x-goog-api-key") });
    return new Response(JSON.stringify({
      error: { message: "retry in 1.2s", details: [{ retryDelay: "2.5s" }] },
    }), { status: 429, headers: { "retry-after": "3" } });
  };
  try {
    const first = await generateGeminiContent({ apiKey: "simulation-secret", model: "simulation-model", body: {}, timeoutMs: 1_000 });
    const second = await generateGeminiContent({ apiKey: "evaluation-secret", model: "evaluation-model", body: {}, timeoutMs: 1_000 });
    assert.equal(first.status, 429);
    assert.equal(first.retryAfterSeconds, 3);
    assert.equal(second.status, 429);
    assert.deepEqual(seen.map((entry) => entry.key), ["simulation-secret", "evaluation-secret"]);
    assert.match(seen[0].url, /simulation-model/);
    assert.match(seen[1].url, /evaluation-model/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not echo malformed provider payloads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("private conversation content", { status: 500 });
  try {
    const attempt = await generateGeminiContent({ apiKey: "secret", model: "model", body: {}, timeoutMs: 1_000 });
    assert.equal(attempt.status, 500);
    assert.equal(attempt.data, null);
    assert.doesNotMatch(attempt.errorMessage, /private conversation content/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("classifies transport failures independently of provider credentials", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  try {
    const attempt = await generateGeminiContent({ apiKey: "secret", model: "model", body: {}, timeoutMs: 1_000 });
    assert.equal(attempt.status, 502);
    assert.equal(attempt.ok, false);
    assert.equal(attempt.errorMessage, "Falha de rede ao chamar Gemini.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
