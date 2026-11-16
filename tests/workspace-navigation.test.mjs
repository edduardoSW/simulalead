import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLastWorkspaceLocation,
  readLastWorkspaceLocation,
  resolveWorkspaceLocation,
  sanitizeWorkspaceLocation,
  saveLastWorkspaceLocation,
  pathForSection,
  sectionFromPath,
} from "../lib/workspace-routes.ts";

const scope = {
  conversationIds: new Set(["conversation-1"]),
  scenarioIds: new Set(["scenario-1"]),
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("keeps the public landing separate from the authenticated dashboard", () => {
  assert.equal(pathForSection("home"), "/home");
  assert.equal(sectionFromPath("/"), null);
  assert.equal(sectionFromPath("/home"), "home");
});

test("restores only valid and authorized workspace locations", () => {
  assert.equal(resolveWorkspaceLocation("/home", "/conversas?conversation=conversation-1", scope), "/conversas?conversation=conversation-1");
  assert.equal(resolveWorkspaceLocation("/home", "/conversas?conversation=other-user", scope), "/conversas");
  assert.equal(resolveWorkspaceLocation("/configuracoes", "/conversas?conversation=conversation-1", scope), "/configuracoes");
  assert.equal(sanitizeWorkspaceLocation("https://evil.example/steal", scope), null);
});

test("stores navigation per user and clears it on logout", () => {
  const storage = memoryStorage();
  saveLastWorkspaceLocation(storage, "seller-1", "/treinamentos?training=scenario-1");
  assert.equal(readLastWorkspaceLocation(storage, "seller-1"), "/treinamentos?training=scenario-1");
  assert.equal(readLastWorkspaceLocation(storage, "seller-2"), null);
  clearLastWorkspaceLocation(storage, "seller-1");
  assert.equal(readLastWorkspaceLocation(storage, "seller-1"), null);
});
