import { readFile } from "node:fs/promises";

async function loadLocalEnvironment() {
  const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function listFlashLiteModels(label, apiKey, configuredModel) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
    headers: { "x-goog-api-key": apiKey },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${label}: ListModels respondeu HTTP ${response.status} (${payload?.error?.status || "sem status"}).`);
  }
  const models = (payload.models || [])
    .filter((model) => /flash-lite/i.test(model.name || ""))
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => String(model.name).replace(/^models\//, ""))
    .sort();
  return {
    label,
    status: response.status,
    configuredModel,
    configuredModelAvailable: models.includes(configuredModel),
    compatibleFlashLiteModels: models,
  };
}

await loadLocalEnvironment();
const configurations = [
  ["simulation", process.env.GEMINI_API_KEY?.trim(), process.env.GEMINI_MODEL?.trim()],
  ["evaluation", process.env.GEMINI_EVALUATION_API_KEY?.trim(), process.env.GEMINI_EVALUATION_MODEL?.trim()],
];
for (const [label, apiKey, model] of configurations) {
  if (!apiKey || !model) throw new Error(`${label}: chave ou modelo não configurado.`);
}

const results = await Promise.all(configurations.map(([label, apiKey, model]) => listFlashLiteModels(label, apiKey, model)));
console.log(JSON.stringify(results, null, 2));
