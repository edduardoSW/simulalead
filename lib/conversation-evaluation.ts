import type { LocalConversation, LocalEvaluation } from "./local-domain";

const includesAny = (text: string, terms: RegExp) => terms.test(text);

export function buildConversationEvaluation(conversation: LocalConversation): LocalEvaluation {
  const sellerMessages = conversation.messages.filter((message) => message.sender === "seller");
  const leadMessages = conversation.messages.filter((message) => message.sender === "contact");
  const sellerText = sellerMessages.map((message) => message.text).join(" ");
  const questionCount = sellerMessages.filter((message) => message.text.includes("?")).length;
  const introduced = includesAny(sellerText, /\b(olá|ola|oi|bom dia|boa tarde|boa noite|me chamo|meu nome)\b/i);
  const discovered = questionCount >= 2 || includesAny(sellerText, /\b(como|qual|quais|por que|desafio|problema|objetivo|processo|prioridade)\b/i);
  const connectedValue = includesAny(sellerText, /\b(ajudar|resultado|benefício|beneficio|ganho|reduzir|melhorar|solução|solucao)\b/i);
  const proposedNextStep = includesAny(sellerText, /\b(próximo passo|proximo passo|reunião|reuniao|agenda|agendar|retorno|continuar|enviar)\b/i);
  const concise = sellerMessages.length > 0 && sellerText.length / sellerMessages.length <= 420;
  const balanced = leadMessages.length >= Math.max(1, Math.floor(sellerMessages.length * .45));

  const checks = [introduced, discovered, connectedValue, proposedNextStep, concise, balanced];
  const score = Math.min(96, 38 + checks.filter(Boolean).length * 9 + Math.min(4, questionCount) * 2);
  const strengths = [
    introduced && "Abertura clara e profissional.",
    discovered && "Boa tentativa de entender o contexto antes de avançar.",
    connectedValue && "A solução foi relacionada a um possível resultado para o lead.",
    concise && "Mensagens objetivas, adequadas para uma conversa comercial.",
    balanced && "A conversa deu espaço para o lead responder e apresentar sinais reais.",
  ].filter(Boolean) as string[];
  const improvements = [
    !introduced && "Comece se apresentando e explique o motivo do contato em uma frase.",
    !discovered && "Faça mais perguntas abertas sobre cenário, impacto e prioridade.",
    !connectedValue && "Conecte a solução ao problema mencionado, evitando apresentar recursos cedo demais.",
    !proposedNextStep && "Feche a conversa combinando um próximo passo específico e de baixo atrito.",
    !concise && "Divida mensagens longas em blocos curtos para manter o ritmo natural.",
    !balanced && "Reduza a quantidade de argumentos seguidos e dê mais espaço para o lead falar.",
  ].filter(Boolean) as string[];

  return {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    score,
    summary: score >= 80
      ? "Abordagem consistente e próxima de uma conversa comercial real. O lead recebeu contexto, espaço e direção."
      : score >= 62
        ? "A conversa teve uma base positiva, mas ainda pode ganhar mais descoberta e clareza no próximo passo."
        : "A abordagem precisa desacelerar: investigue melhor antes de apresentar a solução e conduza um passo por vez.",
    strengths: strengths.length ? strengths.slice(0, 3) : ["Você manteve a conversa ativa até o encerramento."],
    improvements: improvements.length ? improvements.slice(0, 3) : ["Continue variando perguntas e validando o entendimento do lead."],
    nextStep: proposedNextStep
      ? "Na próxima simulação, confirme o compromisso do lead com data, responsável e objetivo."
      : "Na próxima simulação, encerre propondo uma ação concreta: retorno, diagnóstico ou envio de material.",
    createdAt: new Date().toISOString(),
  };
}
