import type { LocalData } from "./local-domain";

export function buildGenerationSnapshot(data: LocalData, conversationId: string, batchId: string) {
  const conversation = data.conversations.find((item) => item.id === conversationId);
  if (!conversation) return null;
  const account = data.accounts.find((item) => item.id === conversation.accountId);
  const opportunity =
    data.opportunities.find((item) => item.id === conversation.opportunityId) ||
    data.opportunities.find((item) => item.accountId === conversation.accountId);
  if (!account || !opportunity) return null;
  const product = data.products.find((item) => item.id === opportunity.primaryProductId);
  const contact =
    account.contacts.find((item) => item.id === conversation.currentContactId) ||
    account.contacts.find((item) => item.id === opportunity.currentContactId) ||
    account.contacts[0];
  if (!contact) return null;
  const lastBatchIndex = conversation.messages.reduce(
    (found, message, index) => message.batchId === batchId ? index : found,
    -1,
  );
  if (lastBatchIndex < 0) return null;
  const messages = conversation.messages
    .slice(0, lastBatchIndex + 1)
    .filter((message) => message.sender !== "system")
    .map((message) => ({
      id: message.id,
      from: message.sender === "seller" ? "seller" as const : "lead" as const,
      text: message.text,
      createdAt: message.createdAt,
    }));
  return {
    batchResponse: conversation.messages.find((message) => message.sender === "contact" && message.batchId === batchId),
    account,
    contact,
    lead: {
      id: account.id,
      name: contact.name,
      role: contact.jobTitle,
      company: account.name,
      segment: account.segment,
      companySize: account.employeeCount,
      problem: opportunity.need || account.knownProblem,
      solution: product?.name,
      communicationStyle: account.difficulty === "Difícil" ? "reservado e criterioso" : "profissional e objetivo",
      visibleObjection: product?.commonObjections?.[0],
      secondaryObjection: product?.limitations?.[0],
      hiddenConcern: opportunity.decisionAccess === "blocked" ? "a decisão depende de outras pessoas" : undefined,
      decisionBarrier: opportunity.nextAction,
      decisionPower: [
        contact.buyingRole,
        typeof contact.influence === "number" ? `influencia ${contact.influence}/5` : "influencia nao informada",
        typeof contact.decisionPower === "number" ? `decisao ${contact.decisionPower}/5` : "autonomia nao informada",
      ].join("; "),
      motivation: opportunity.possibleApplication,
      meetingConditions: opportunity.trainingObjective,
      difficulty: account.difficulty,
      contacts: account.contacts.map((item) => ({
        name: item.name,
        jobTitle: item.jobTitle,
        department: item.department,
        buyingRole: item.buyingRole,
        status: item.visibility,
      })),
    },
    messages,
  };
}
