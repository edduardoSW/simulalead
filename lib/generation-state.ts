import type { LocalConversation, LocalMessage } from "./local-domain";

export type ActiveGeneration = {
  batchId: string;
  requestId: string;
  operationId: string;
  phase: "recovering" | "generating";
};

export type GenerationError = {
  conversationId: string;
  batchId: string;
  requestId: string;
  message: string;
};

export type GenerationErrors = Record<string, GenerationError>;

export function generationKey(conversationId: string, batchId: string) {
  return `${conversationId}:${batchId}`;
}

export function hasBatchResponse(messages: LocalMessage[], batchId: string) {
  return messages.some((message) => message.sender === "contact" && message.batchId === batchId);
}

export function reconcileGenerationErrors(errors: GenerationErrors, conversations: LocalConversation[]) {
  const next = { ...errors };
  let changed = false;
  for (const [key, error] of Object.entries(errors)) {
    const conversation = conversations.find((item) => item.id === error.conversationId);
    if (conversation && hasBatchResponse(conversation.messages, error.batchId)) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : errors;
}

export function isCurrentGeneration(active: Map<string, ActiveGeneration>, conversationId: string, operationId: string) {
  return active.get(conversationId)?.operationId === operationId;
}
