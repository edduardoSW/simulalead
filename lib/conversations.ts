export type AssetVisibility = "profile_only" | "conversation_only" | "both";
export type ColorSwatch = { name: string; hex: string };
export type LeadAsset = {
  id: string;
  type: "color_palette" | "image" | "link" | "file";
  title: string;
  visibility: AssetVisibility;
  colors?: ColorSwatch[];
  url?: string;
  alt?: string;
};
export type InboxMessage = {
  id: string;
  from: "seller" | "lead";
  text?: string;
  createdAt: string;
  status: "sent" | "scheduled" | "delivered" | "read" | "failed";
  attachments?: LeadAsset[];
};
export type ConversationStatus = "not_started" | "waiting" | "active" | "completed" | "failed";
export type Conversation = {
  id: string;
  leadId: string;
  name: string;
  company: string;
  role: string;
  segment: string;
  size: string;
  location: string;
  source: string;
  interest: string;
  context: string;
  need: string;
  priority: "Alta" | "Média" | "Baixa";
  difficulty: "Fácil" | "Intermediário" | "Difícil";
  startsBy: "seller_starts" | "lead_starts";
  status: ConversationStatus;
  unread: number;
  responseDelay: "minutes" | "standard" | "hours" | "normal" | "slow";
  tags: string[];
  objective: string;
  assets: LeadAsset[];
  messages: InboxMessage[];
};

const palette: LeadAsset = { id: "palette-vitta", type: "color_palette", title: "Paleta atual da Vitta", visibility: "both", colors: [
  { name: "Roxo principal", hex: "#6C4CF1" }, { name: "Roxo escuro", hex: "#3F2A9D" },
  { name: "Branco", hex: "#FFFFFF" }, { name: "Cinza claro", hex: "#F5F5F7" },
] };
const reference: LeadAsset = { id: "ref-nomad", type: "image", title: "Referência de vitrine", visibility: "conversation_only", url: "/store-reference.svg", alt: "Referência visual fictícia de uma loja online" };
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const leadMessage = (id: string, text: string, minutes: number, attachments?: LeadAsset[]): InboxMessage => ({ id, from: "lead", text, createdAt: ago(minutes), status: "delivered", attachments });
const sellerMessage = (id: string, text: string, minutes: number, status: InboxMessage["status"] = "read"): InboxMessage => ({ id, from: "seller", text, createdAt: ago(minutes), status });

export const demoConversations: Conversation[] = [
  { id:"c1",leadId:"l1",name:"Carla Viana",company:"Clínica Vitta",role:"Diretora administrativa",segment:"Saúde",size:"28 pessoas",location:"Belo Horizonte, MG",source:"Indicação",interest:"Novo site institucional",context:"A clínica ampliou especialidades e quer centralizar agendamentos.",need:"Apresentar serviços com clareza e facilitar agendamentos.",priority:"Alta",difficulty:"Intermediário",startsBy:"seller_starts",status:"not_started",unread:0,responseDelay:"standard",tags:["Site","Saúde"],objective:"Descobrir o impacto do site atual e conquistar uma reunião de diagnóstico.",assets:[palette],messages:[] },
  { id:"c2",leadId:"l2",name:"Miguel Torres",company:"Nomad Supply",role:"Fundador",segment:"E-commerce",size:"12 pessoas",location:"Curitiba, PR",source:"Evento",interest:"E-commerce",context:"A marca vende pelas redes sociais e prepara sua primeira loja própria.",need:"Reduzir pedidos manuais e organizar o catálogo.",priority:"Alta",difficulty:"Fácil",startsBy:"seller_starts",status:"active",unread:1,responseDelay:"minutes",tags:["E-commerce","Inbound"],objective:"Qualificar operação, prazo e critérios da nova loja.",assets:[],messages:[sellerMessage("m21","Oi, Miguel! Vi que vocês estão estruturando a loja própria. Como os pedidos funcionam hoje?",38),leadMessage("m22","Hoje tudo chega por mensagem e já virou um gargalo. Separei uma referência do tipo de vitrine que imaginamos.",7,[reference])] },
  { id:"c3",leadId:"l3",name:"Renata Lima",company:"Arco Contábil",role:"Head comercial",segment:"Contabilidade",size:"64 pessoas",location:"São Paulo, SP",source:"Prospecção",interest:"CRM comercial",context:"A equipe cresceu, mas acompanha oportunidades em planilhas.",need:"Ter visibilidade do funil e reduzir perda de follow-ups.",priority:"Alta",difficulty:"Difícil",startsBy:"seller_starts",status:"waiting",unread:0,responseDelay:"hours",tags:["CRM","Enterprise"],objective:"Mapear o processo atual antes de posicionar a solução.",assets:[],messages:[sellerMessage("m31","Renata, notei que a Arco está ampliando a operação. Posso entender como vocês acompanham as oportunidades hoje?",2,"scheduled")] },
  { id:"c4",leadId:"l4",name:"Paula Nunes",company:"Casa Lume",role:"Gerente de marketing",segment:"Decoração",size:"45 pessoas",location:"Florianópolis, SC",source:"Formulário",interest:"Identidade digital",context:"A marca atualiza sua presença digital após abrir duas lojas.",need:"Unificar a identidade entre site e campanhas.",priority:"Média",difficulty:"Fácil",startsBy:"lead_starts",status:"active",unread:2,responseDelay:"minutes",tags:["Branding","Visual"],objective:"Entender o escopo e combinar a próxima etapa.",assets:[palette],messages:[leadMessage("m41","Oi! Preenchi o formulário porque precisamos atualizar nosso site e alinhar melhor a identidade da marca.",18)] },
  { id:"c5",leadId:"l5",name:"Eduardo Reis",company:"Atlas Log",role:"Coordenador de operações",segment:"Logística",size:"180 pessoas",location:"Campinas, SP",source:"Prospecção",interest:"Automação",context:"A operação depende de conferências manuais em três sistemas.",need:"Reduzir retrabalho sem interromper a operação.",priority:"Média",difficulty:"Difícil",startsBy:"seller_starts",status:"failed",unread:0,responseDelay:"normal",tags:["Automação"],objective:"Quantificar o retrabalho e validar patrocinadores internos.",assets:[],messages:[sellerMessage("m51","Eduardo, posso te mostrar nossa plataforma?",65,"failed")] },
  { id:"c6",leadId:"l6",name:"Luiza Prado",company:"Orbe Educação",role:"Analista de projetos",segment:"Educação",size:"320 pessoas",location:"Recife, PE",source:"Webinar",interest:"Portal do aluno",context:"Luiza pesquisa alternativas para um comitê executivo.",need:"Reunir opções e estimativas para a diretoria.",priority:"Baixa",difficulty:"Intermediário",startsBy:"seller_starts",status:"active",unread:0,responseDelay:"normal",tags:["Sem decisão","Comitê"],objective:"Mapear decisores e ajudar Luiza a construir o caso interno.",assets:[],messages:[sellerMessage("m61","Luiza, quais áreas participam dessa avaliação?",240),leadMessage("m62","Eu levanto as opções, mas a decisão passa por Operações e pela diretoria financeira.",225)] },
  { id:"c7",leadId:"l7",name:"Bruno Azevedo",company:"Ferro & Forma",role:"CTO",segment:"Indústria",size:"490 pessoas",location:"Joinville, SC",source:"Evento",interest:"Cloud",context:"A empresa compara três fornecedores para modernizar a infraestrutura.",need:"Ganhar escala com previsibilidade de custo.",priority:"Alta",difficulty:"Difícil",startsBy:"seller_starts",status:"active",unread:1,responseDelay:"slow",tags:["Concorrência","Cloud"],objective:"Descobrir critérios de comparação sem desqualificar concorrentes.",assets:[],messages:[sellerMessage("m71","Bruno, além de preço, o que mais pesa nessa comparação?",94),leadMessage("m72","Confiabilidade e clareza na migração. Duas propostas parecem boas no papel, mas estão vagas nesse ponto.",36)] },
  { id:"c8",leadId:"l8",name:"Sofia Campos",company:"Verde Vivo",role:"Sócia",segment:"Alimentação",size:"9 pessoas",location:"Salvador, BA",source:"Prospecção",interest:"Marketing digital",context:"A empresa quer aumentar pedidos corporativos.",need:"Gerar demanda previsível no B2B.",priority:"Média",difficulty:"Intermediário",startsBy:"seller_starts",status:"waiting",unread:0,responseDelay:"slow",tags:["Resposta lenta"],objective:"Diagnosticar o canal atual e propor um experimento mensurável.",assets:[],messages:[sellerMessage("m81","Sofia, como chegam os pedidos corporativos hoje?",12,"scheduled")] },
  { id:"c9",leadId:"l9",name:"André Melo",company:"Nexo Imóveis",role:"Diretor comercial",segment:"Imobiliário",size:"76 pessoas",location:"Goiânia, GO",source:"Indicação",interest:"Business Intelligence",context:"Gestores consolidam relatórios manualmente toda semana.",need:"Acompanhar conversão e produtividade por equipe.",priority:"Média",difficulty:"Intermediário",startsBy:"seller_starts",status:"completed",unread:0,responseDelay:"normal",tags:["BI","Concluída"],objective:"Validar métricas e fechar uma sessão técnica.",assets:[],messages:[sellerMessage("m91","Posso envolver nosso especialista na terça às 15h?",1440),leadMessage("m92","Fechado. Vou incluir nossa gerente de operações também.",1420)] },
  { id:"c10",leadId:"l10",name:"Iara Monteiro",company:"Lira Jurídico",role:"Sócia",segment:"Jurídico",size:"35 pessoas",location:"Rio de Janeiro, RJ",source:"Prospecção",interest:"Cibersegurança",context:"O escritório revisa controles após uma auditoria.",need:"Proteger documentos e acessos remotos.",priority:"Alta",difficulty:"Difícil",startsBy:"seller_starts",status:"active",unread:0,responseDelay:"normal",tags:["Informação oculta","LGPD"],objective:"Investigar riscos e processo de aprovação sem presumir o resultado da auditoria.",assets:[],messages:[sellerMessage("m101","Quais controles estão no escopo dessa revisão?",310),leadMessage("m102","Acesso remoto e compartilhamento de documentos, principalmente. Ainda estamos definindo prioridades.",300)] },
];

// Real-world delays in minutes. The backend chooses a value once and persists available_at.
export const delayRanges = { minutes: [1, 5], standard: [10, 45], hours: [60, 240], normal: [10, 45], slow: [60, 240] } as const;
