import Link from "next/link";

const features = [
  { icon: "chat", title: "Conversas próximas do real", text: "Leads com personalidade, contexto, objeções e diferentes níveis de dificuldade para o SDR praticar de verdade." },
  { icon: "target", title: "Treino com objetivo", text: "Cada simulação trabalha descoberta, qualificação, contorno de objeções e condução do próximo passo." },
  { icon: "feedback", title: "Feedback acionável", text: "Ao encerrar, o SDR recebe pontuação, pontos fortes, oportunidades de melhoria e orientação para o próximo treino." },
  { icon: "team", title: "Evolução do time", text: "Gestores acompanham atividade, avaliações e consumo da IA em um workspace seguro para toda a operação." },
];

const steps = [
  ["01", "Escolha o cenário", "Selecione um lead, serviço e nível de dificuldade alinhados ao momento do SDR."],
  ["02", "Conduza a conversa", "Aborde, investigue e responda às objeções em um chat sem roteiro engessado."],
  ["03", "Revise o feedback", "Entenda o que funcionou, onde melhorar e qual habilidade praticar na sequência."],
];

export function ProductLanding() {
  return <main className="product-landing">
    <nav className="sales-nav" aria-label="Navegação principal">
      <Link className="sales-brand" href="/"><span>S</span><b>simulaLEAD</b></Link>
      <div><a href="#plataforma">Plataforma</a><a href="#como-funciona">Como funciona</a><a href="#para-quem">Para quem</a></div>
      <Link className="sales-login" href="/entrar">Entrar <span aria-hidden="true">↗</span></Link>
    </nav>

    <section className="sales-hero">
      <div className="sales-hero-copy">
        <p className="sales-kicker"><i/> Treinamento comercial com IA</p>
        <h1>Prepare SDRs para conversas que parecem reais.</h1>
        <p>O SimulaLead é uma plataforma de simulação comercial para SDRs praticarem abordagem, descoberta, qualificação e objeções antes de falar com oportunidades reais.</p>
        <div className="sales-actions"><Link href="/entrar">Começar a treinar <span aria-hidden="true">↗</span></Link><a href="#como-funciona">Conhecer a plataforma</a></div>
        <div className="sales-proof"><span><b>300</b> personas comerciais</span><span><b>24/7</b> disponível para treino</span><span><b>1:1</b> feedback por conversa</span></div>
      </div>
      <SalesChatPreview />
    </section>

    <section className="sales-trust" aria-label="Habilidades treinadas"><span>PROSPECÇÃO</span><i/><span>DESCOBERTA</span><i/><span>QUALIFICAÇÃO</span><i/><span>OBJEÇÕES</span><i/><span>PRÓXIMO PASSO</span></section>

    <section className="sales-section" id="plataforma">
      <div className="sales-section-heading"><p className="sales-kicker"><i/> Prática deliberada</p><h2>Treino seguro.<br/>Conversa natural.<br/>Evolução mensurável.</h2><p>Transforme teoria comercial em repertório prático sem colocar leads, marca ou pipeline em risco.</p></div>
      <div className="sales-feature-grid">{features.map((feature,index)=><article key={feature.title} className={index===0?"featured":""}><ProductIcon name={feature.icon}/><span>0{index+1}</span><h3>{feature.title}</h3><p>{feature.text}</p></article>)}</div>
    </section>

    <section className="sales-flow" id="como-funciona">
      <div className="sales-flow-visual"><div className="score-orbit"><strong>86</strong><span>pontuação</span></div><div className="feedback-note good"><b>✓ Ponto forte</b><span>Boa pergunta de descoberta.</span></div><div className="feedback-note improve"><b>↗ Para melhorar</b><span>Combine um próximo passo específico.</span></div></div>
      <div className="sales-flow-copy"><p className="sales-kicker"><i/> Como funciona</p><h2>Da simulação ao feedback em três passos.</h2><div>{steps.map(([number,title,text])=><article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><Link href="/entrar">Experimentar o SimulaLead <span aria-hidden="true">↗</span></Link></div>
    </section>

    <section className="sales-audience" id="para-quem">
      <div><p className="sales-kicker"><i/> Feito para receita</p><h2>Uma plataforma para quem desenvolve conversas comerciais.</h2></div>
      <div className="audience-cards"><article><ProductIcon name="headset"/><h3>SDRs e BDRs</h3><p>Ganhe segurança, teste abordagens e pratique objeções sem depender de roleplays pontuais.</p></article><article><ProductIcon name="chart"/><h3>Líderes comerciais</h3><p>Crie uma rotina de treinamento consistente e acompanhe a evolução do time com evidências.</p></article><article><ProductIcon name="spark"/><h3>Onboarding de vendas</h3><p>Acelere a preparação de novas pessoas com cenários próximos da operação real.</p></article></div>
    </section>

    <section className="sales-cta"><div><p className="sales-kicker"><i/> Seu próximo treino começa aqui</p><h2>Mais preparo antes da próxima conversa real.</h2><p>Pratique, receba feedback e construa confiança comercial todos os dias.</p></div><Link href="/entrar">Entrar na plataforma <span aria-hidden="true">↗</span></Link></section>

    <footer className="sales-footer"><Link className="sales-brand" href="/"><span>S</span><b>simulaLEAD</b></Link><p>Treinamento inteligente para SDRs e equipes comerciais.</p><Link href="/entrar">Acessar plataforma</Link></footer>
  </main>;
}

function SalesChatPreview(){return <div className="sales-chat-card"><header><div><span className="sales-avatar">MC</span><p><b>Marina Costa</b><small><i/> Lead online</small></p></div><span className="difficulty-pill">Intermediário</span></header><div className="sales-chat-body"><div className="sales-scenario"><ProductIcon name="spark"/><p><b>Objetivo do treino</b>Descobrir o processo atual e conquistar um próximo passo.</p></div><p className="lead-bubble">Oi, recebi sua mensagem. Pode me explicar o motivo do contato?</p><p className="seller-bubble">Claro. Antes, queria entender como sua equipe acompanha os novos pedidos hoje.</p><p className="lead-bubble">Usamos planilhas. Funciona, mas está ficando difícil acompanhar.</p><span className="typing-bubble"><i/><i/><i/> Marina está respondendo</span></div><footer><span><ProductIcon name="shield"/> Ambiente seguro para praticar</span><b>Próximo de uma conversa real</b></footer></div>}

function ProductIcon({name}:{name:string}){
  const paths:Record<string,React.ReactNode>={
    chat:<><path d="M4 5.5h16v10H9l-5 4v-14Z"/><path d="M8 10h8M8 13h5"/></>,
    target:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m15 9 5-5M17 4h3v3"/></>,
    feedback:<><path d="M5 4h14v16H5z"/><path d="m8 9 2 2 5-5M8 15h8"/></>,
    team:<><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-4 2-7 6-7s6 3 6 7M15 14c4 0 6 2 6 6"/></>,
    headset:<><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M4 13h3v6H5a1 1 0 0 1-1-1v-5ZM20 13h-3v6h2a1 1 0 0 0 1-1v-5ZM17 19c-1 2-3 2-5 2"/></>,
    chart:<><path d="M4 20V9M10 20V4M16 20v-7M22 20H2"/></>,
    spark:<><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></>,
    shield:<><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
  };
  return <span className="product-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg></span>;
}
