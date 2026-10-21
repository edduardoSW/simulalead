export type LeadDifficulty = "Fácil" | "Intermediário" | "Difícil";
export type BuyingRole = "gatekeeper" | "user" | "influencer" | "champion" | "technical_evaluator" | "financial_approver" | "decision_maker" | "executive_sponsor";
export type SimulatedContact = { id:string; name:string; jobTitle:string; department:string; buyingRole:BuyingRole; influence:number; decisionPower:number; status:"known"|"mentioned"|"unknown"; relationship:"Novo"|"Contato iniciado"|"Engajado"; nextAction:string };

export type LeadProfile = {
  id: string;
  name: string;
  role: string;
  segment: string;
  companySize: string;
  solution: string;
  problem: string;
  difficulty: LeadDifficulty;
  communicationStyle: string;
  visibleObjection: string;
  secondaryObjection: string;
  hiddenConcern: string;
  decisionBarrier: string;
  meetingConditions: string;
  possibleOutcome: "meeting" | "proposal" | "think" | "consult_partner" | "competitor" | "closed_lost";
  motivation: string;
  decisionPower: string;
  company: string;
  founder: string;
  foundedYear: number;
  location: string;
  companyStory: string;
  currentMoment: string;
  publicHistory: string;
  contacts: SimulatedContact[];
};

const firstNames = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Giovana", "Heitor", "Ísis", "João", "Karen", "Lucas", "Marina", "Nando", "Olívia"];
const lastNames = ["Alves", "Barros", "Castro", "Diniz", "Esteves", "Freitas", "Gomes", "Lima", "Moura", "Neves", "Pires", "Reis", "Sales", "Tavares", "Viana", "Xavier", "Abreu", "Brito", "Coelho", "Duarte"];
const segments = ["Clínica médica", "Indústria", "Escritório contábil", "E-commerce", "Construtora", "Escola", "Logística", "Serviços B2B", "Restaurante", "Imobiliária"];
const sizes = ["Microempresa", "10–49 pessoas", "50–199 pessoas", "200–499 pessoas"];
const solutions = [
  ["Criação de site", "A empresa não possui presença digital profissional"],
  ["E-commerce", "As vendas dependem exclusivamente de canais físicos"],
  ["CRM comercial", "Leads são perdidos em planilhas e conversas dispersas"],
  ["Automação de processos", "A equipe gasta muitas horas em tarefas repetitivas"],
  ["Business Intelligence", "A liderança decide sem indicadores confiáveis"],
  ["Cibersegurança", "A operação está exposta a acessos e dados desprotegidos"],
  ["Cloud e infraestrutura", "Os sistemas estão lentos e não escalam"],
  ["Desenvolvimento de sistema", "O software atual não acompanha o processo da empresa"],
  ["Suporte de TI", "Falhas técnicas interrompem o trabalho com frequência"],
  ["Marketing digital", "A marca tem pouca visibilidade e baixa geração de demanda"],
];
const objections = ["O investimento parece alto", "Já tentamos algo parecido", "Não é prioridade agora", "Preciso comparar outros fornecedores", "Minha equipe não terá tempo", "Preciso falar com outro decisor"];
const concerns = ["tem medo de uma implantação longa", "teve uma experiência ruim com fornecedor", "não confia no retorno prometido", "receia resistência da equipe", "possui orçamento menor do que aparenta", "prefere internamente um concorrente"];
const motivations = ["aumentar faturamento", "reduzir custos", "ganhar produtividade", "diminuir riscos", "organizar o crescimento", "melhorar a experiência dos clientes"];
const styles = ["cordial e detalhista", "objetivo e impaciente", "analítico e questionador", "reservado e desconfiado", "informal e comunicativo"];

const secondaryObjections = ["tem receio de que o projeto demore mais que o previsto", "não quer sobrecarregar a equipe durante a implantação", "ainda não entendeu como o retorno será medido", "tem dúvidas sobre suporte após a entrega", "precisa comparar o escopo com outras alternativas", "não sabe se este é o melhor momento para mudar"];
const decisionBarriers = ["precisa conversar com a sócia antes de avançar", "depende da aprovação do financeiro", "o projeto compete com outra prioridade interna", "um comitê com três áreas participa da decisão", "o orçamento do trimestre ainda não foi liberado", "o contato influencia, mas não assina o contrato"];
const meetingConditions = ["compreender o cenário, explicar o processo, reduzir o risco percebido e dar um motivo concreto para a conversa", "quantificar o impacto atual, mostrar um exemplo relevante e esclarecer os próximos passos", "tratar as dúvidas de implantação, apresentar prazo realista e confirmar quem precisa participar", "demonstrar um diferencial específico sem atacar concorrentes e alinhar o objetivo da próxima conversa"];
const possibleOutcomes: LeadProfile["possibleOutcome"][] = ["meeting", "proposal", "think", "consult_partner", "competitor", "closed_lost"];
const companyNames = ["Vitta Norte", "Aurora Foods", "Conta Clara", "Nomad Supply", "Base Engenharia", "Horizonte Escola", "Atlas Log", "Nexo Partners", "Mesa Viva", "Lume Imóveis"];
const cities = ["Belo Horizonte, MG", "São Paulo, SP", "Curitiba, PR", "Recife, PE", "Campinas, SP", "Florianópolis, SC", "Goiânia, GO", "Salvador, BA"];
const moments = ["está ampliando a equipe e revisando os processos internos", "abriu uma nova unidade e precisa organizar o crescimento", "quer reduzir tarefas manuais antes do próximo ciclo comercial", "está comparando fornecedores para um projeto prioritário", "passa por uma modernização da operação"];

function contactsFor(index:number, size:string):SimulatedContact[]{
  const person=(offset:number)=>`${firstNames[(index+offset)%firstNames.length]} ${lastNames[(index*5+offset)%lastNames.length]}`;
  if(size==="Microempresa") return [{id:`${index}-owner`,name:person(0),jobTitle:"Proprietário(a)",department:"Direção",buyingRole:"decision_maker",influence:5,decisionPower:5,status:"known",relationship:"Novo",nextAction:"Entender a prioridade do negócio"}];
  if(size==="10–49 pessoas") return [{id:`${index}-manager`,name:person(0),jobTitle:"Gerente",department:"Operações",buyingRole:"influencer",influence:4,decisionPower:3,status:"known",relationship:"Novo",nextAction:"Qualificar o problema"},{id:`${index}-owner`,name:person(2),jobTitle:"Sócio(a)",department:"Direção",buyingRole:"decision_maker",influence:5,decisionPower:5,status:"mentioned",relationship:"Novo",nextAction:"Conquistar uma apresentação"}];
  const contacts:SimulatedContact[]=[{id:`${index}-gate`,name:person(0),jobTitle:size==="200–499 pessoas"?"Assistente administrativo":"Analista",department:"Administrativo",buyingRole:"gatekeeper",influence:2,decisionPower:0,status:"known",relationship:"Novo",nextAction:"Explicar o motivo do contato"},{id:`${index}-manager`,name:person(2),jobTitle:"Gerente",department:"Área responsável",buyingRole:"influencer",influence:4,decisionPower:2,status:"unknown",relationship:"Novo",nextAction:"Ainda não identificado"},{id:`${index}-decision`,name:person(4),jobTitle:"Diretor(a)",department:"Diretoria",buyingRole:"decision_maker",influence:5,decisionPower:5,status:"unknown",relationship:"Novo",nextAction:"Decisor ainda não identificado"}];
  if(size==="200–499 pessoas") contacts.splice(2,0,{id:`${index}-tech`,name:person(3),jobTitle:"Coordenador técnico",department:"Tecnologia",buyingRole:"technical_evaluator",influence:4,decisionPower:1,status:"unknown",relationship:"Novo",nextAction:"Avaliação técnica necessária"});
  return contacts;
}

export const leadProfiles: LeadProfile[] = Array.from({ length: 300 }, (_, index) => {
  const difficulty: LeadDifficulty = index % 3 === 0 ? "Fácil" : index % 3 === 1 ? "Intermediário" : "Difícil";
  const solution = solutions[index % solutions.length];
  const companySize = sizes[(index * 5) % sizes.length];
  const contacts = contactsFor(index,companySize);
  return {
    id: `lead-ti-${String(index + 1).padStart(3, "0")}`,
    name: contacts[0].name,
    role: contacts[0].jobTitle,
    segment: segments[(index * 7) % segments.length],
    companySize,
    solution: solution[0], problem: solution[1], difficulty,
    communicationStyle: styles[(index * 11) % styles.length],
    visibleObjection: objections[(index * 13) % objections.length],
    secondaryObjection: secondaryObjections[(index * 7) % secondaryObjections.length],
    hiddenConcern: concerns[(index * 17) % concerns.length],
    decisionBarrier: decisionBarriers[(index * 5) % decisionBarriers.length],
    meetingConditions: meetingConditions[index % meetingConditions.length],
    possibleOutcome: possibleOutcomes[index % possibleOutcomes.length],
    motivation: motivations[(index * 19) % motivations.length],
    decisionPower: index % 5 === 0 ? "Influenciador, depende de aprovação" : index % 4 === 0 ? "Compartilha a decisão" : "Decisor final",
    company: companyNames[index % companyNames.length],
    founder: `${firstNames[(index + 4) % firstNames.length]} ${lastNames[(index * 3 + 2) % lastNames.length]}`,
    foundedYear: 2004 + (index % 18),
    location: cities[index % cities.length],
    companyStory: `A ${companyNames[index % companyNames.length]} nasceu para atender o mercado de ${segments[(index * 7) % segments.length].toLowerCase()} com uma operação próxima e especializada. Cresceu principalmente por indicação e agora busca profissionalizar sua estrutura sem perder a relação pessoal com os clientes.`,
    currentMoment: `A empresa ${moments[index % moments.length]}. O tema ganhou prioridade porque ${solution[1].toLowerCase()}.`,
    publicHistory: index % 4 === 0 ? "Já conversou com outro fornecedor, mas não avançou por falta de clareza no escopo." : index % 3 === 0 ? "Baixou um material sobre o tema e aceitou receber uma abordagem consultiva." : "Ainda não houve contato comercial anterior registrado.",
    contacts,
  };
});
