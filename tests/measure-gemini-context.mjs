import {
  buildOptimizedSimulationInstruction,
  buildSimulationInstruction,
  toGeminiContents,
  toOptimizedGeminiContents,
} from "../lib/simulation-context.ts";

const lead = {
  name: "Bruno",
  role: "Gerente",
  company: "Aurora",
  segment: "Alimentos",
  companySize: "50 pessoas",
  problem: "Vendas manuais",
  solution: "E-commerce",
  communicationStyle: "objetivo e cordial",
  visibleObjection: "Falta de tempo",
  hiddenConcern: "Retorno incerto",
  decisionPower: "Influenciador",
  decisionBarrier: "Aprovação da diretoria",
  difficulty: "Intermediário",
  contacts: [{ name: "Bruno", jobTitle: "Gerente", buyingRole: "influencer", status: "known" }],
};

const messages = Array.from({ length: 24 }, (_, index) => ({
  id: `message-${index}`,
  from: index % 2 === 0 ? "seller" : "lead",
  text: index === 4
    ? "Combinamos orçamento e decisão da diretoria na sexta-feira."
    : `Mensagem comercial ${index} sobre necessidade, implantação, valor e próximos passos.`,
}));

const beforeCharacters = buildSimulationInstruction(lead, messages).length + JSON.stringify(toGeminiContents(messages)).length;
const afterCharacters = buildOptimizedSimulationInstruction(lead, messages).length + JSON.stringify(toOptimizedGeminiContents(messages)).length;

console.log(JSON.stringify({
  beforeCharacters,
  afterCharacters,
  reductionPercent: Math.round((1 - afterCharacters / beforeCharacters) * 100),
  beforeMessages: toGeminiContents(messages).length,
  afterMessages: toOptimizedGeminiContents(messages).length,
}, null, 2));
