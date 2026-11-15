export type EvaluationProviderFailure = {
  status: number;
  error: string;
  quotaReason?: string | null;
  retryAfterSeconds?: number;
};

export type EvaluationProviderErrorResult = {
  status: number;
  body: { error: string; retryAfterSeconds?: number };
};

export function classifyEvaluationProviderFailure(attempt: EvaluationProviderFailure, model: string): EvaluationProviderErrorResult {
  const dailyQuota = /daily|per.?day|requestsperday|quota_exceeded/i.test(`${attempt.quotaReason || ""} ${attempt.error}`);
  if (attempt.status === 400) return { status: 502, body: { error: "A API Gemini rejeitou a configuração da avaliação (400). Verifique o modelo e os parâmetros configurados." } };
  if (attempt.status === 401) return { status: 503, body: { error: "A chave da API de avaliação é inválida, foi revogada, está incompleta ou não foi vinculada corretamente ao projeto (401)." } };
  if (attempt.status === 403) return { status: 503, body: { error: "A chave da API de avaliação não tem permissão para usar o Gemini neste projeto (403)." } };
  if (attempt.status === 404) return { status: 503, body: { error: `O modelo de avaliação ${model} não foi encontrado ou não está disponível para esta chave (404).` } };
  if (attempt.status === 429) return { status: 429, body: { error: dailyQuota ? "A cota diária de avaliações do Gemini foi esgotada (429)." : "O limite temporário de avaliações do Gemini foi atingido (429).", retryAfterSeconds: attempt.retryAfterSeconds } };
  if (attempt.status === 500) return { status: 503, body: { error: "O Gemini encontrou um erro interno ao gerar a avaliação (500). Tente novamente mais tarde." } };
  if (attempt.status === 504) return { status: 504, body: { error: "O Gemini excedeu o tempo limite ao gerar a avaliação (504)." } };
  if (attempt.status === 502) return { status: 502, body: { error: "Não foi possível conectar ao Gemini para gerar a avaliação (502)." } };
  if (attempt.status >= 500) return { status: 503, body: { error: `O serviço de avaliação do Gemini está temporariamente indisponível (${attempt.status}).` } };
  return { status: 502, body: { error: `A API Gemini recusou a avaliação (${attempt.status || "sem status"}).` } };
}
