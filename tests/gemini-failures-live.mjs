import { readFile } from "node:fs/promises";

import { generateGeminiContent } from "../lib/gemini-client.ts";

async function loadLocalEnvironment() {
  const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

await loadLocalEnvironment();
const validKey = process.env.GEMINI_EVALUATION_API_KEY?.trim();
const validModel = process.env.GEMINI_EVALUATION_MODEL?.trim();
if (!validKey || !validModel) throw new Error("Configure a integração de avaliação em .env.local.");
const body = { contents: [{ role: "user", parts: [{ text: "Responda apenas OK." }] }] };

const [invalidCredential, missingModel] = await Promise.all([
  generateGeminiContent({ apiKey: "invalid-test-key", model: validModel, body, timeoutMs: 15_000 }),
  generateGeminiContent({ apiKey: validKey, model: "gemini-model-that-does-not-exist", body, timeoutMs: 15_000 }),
]);

console.log(JSON.stringify({
  invalidCredential: {
    status: invalidCredential.status,
    providerStatus: invalidCredential.data?.error?.status || null,
    identifiesCredential: /api key|credential|unauthenticated/i.test(invalidCredential.errorMessage),
  },
  missingModel: {
    status: missingModel.status,
    providerStatus: missingModel.data?.error?.status || null,
    identifiesModel: /model|not found/i.test(missingModel.errorMessage),
  },
}, null, 2));
