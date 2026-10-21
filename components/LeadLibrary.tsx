"use client";
import { useMemo, useState } from "react";
import { leadProfiles, type LeadDifficulty, type LeadProfile } from "../lib/leads";

export function LeadLibrary({ onStart }: { onStart: (lead: LeadProfile) => void }) {
  const [difficulty, setDifficulty] = useState<"Todos" | LeadDifficulty>("Todos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LeadProfile | null>(null);
  const filtered = useMemo(() => leadProfiles.filter((lead) =>
    (difficulty === "Todos" || lead.difficulty === difficulty) &&
    `${lead.name} ${lead.company} ${lead.founder} ${lead.role} ${lead.segment} ${lead.solution} ${lead.problem} ${lead.location}`.toLowerCase().includes(search.toLowerCase())
  ), [difficulty, search]);
  const visible = filtered.slice(0, page * 18);
  const changeDifficulty = (value: typeof difficulty) => { setDifficulty(value); setPage(1); };

  return <div className="page">
    <div className="page-heading"><p className="eyebrow">300 PERSONAS SINTÉTICAS</p><h1>Leads de tecnologia</h1><p>Pesquise a empresa e entenda seu momento antes de fazer a abordagem.</p></div>
    <div className="lead-toolbar"><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por empresa, sócio, cidade, problema ou solução…"/><div className="filters">{(["Todos","Fácil","Intermediário","Difícil"] as const).map((item) => <button key={item} className={difficulty === item ? "active" : ""} onClick={() => changeDifficulty(item)}>{item}</button>)}</div></div>
    <div className="catalog-count"><strong>{filtered.length}</strong> oportunidades fictícias <span>·</span> Dados públicos disponíveis para pesquisa comercial</div>
    <div className="lead-grid">{visible.map((lead) => <article className="lead-profile" key={lead.id}>
      <div className="lead-profile-head"><span className="avatar">{lead.name.split(" ").map((part) => part[0]).join("")}</span><div><h3>{lead.name}</h3><p>{lead.role} · {lead.company}</p></div><span className={`level ${lead.difficulty.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}`}>{lead.difficulty}</span></div>
      <div className="lead-solution">{lead.solution}</div><p className="lead-problem">{lead.problem}.</p>
      <div className="lead-company-line"><span>⌖ {lead.location}</span><span>Desde {lead.foundedYear}</span></div>
      <div className="lead-actions"><button onClick={() => setSelected(lead)}>Ver ficha completa</button><button onClick={() => onStart(lead)}>Abordar →</button></div>
    </article>)}</div>
    {visible.length < filtered.length && <button className="load-more" onClick={() => setPage((value) => value + 1)}>Carregar mais leads</button>}
    {selected && <LeadDetail lead={selected} onClose={() => setSelected(null)} onStart={() => onStart(selected)}/>}
  </div>;
}

function LeadDetail({lead,onClose,onStart}:{lead:LeadProfile;onClose:()=>void;onStart:()=>void}) {
  return <div className="lead-detail-backdrop" role="presentation" onMouseDown={onClose}><section className="lead-detail" role="dialog" aria-modal="true" aria-labelledby="lead-detail-title" onMouseDown={event=>event.stopPropagation()}>
    <header><button onClick={onClose} aria-label="Fechar ficha">×</button><p className="eyebrow">INTELIGÊNCIA COMERCIAL</p><span>Informações públicas</span></header>
    <div className="lead-detail-hero"><span className="avatar">{lead.company.split(" ").map(word=>word[0]).join("").slice(0,2)}</span><div><h2 id="lead-detail-title">{lead.company}</h2><p>{lead.segment} · {lead.location}</p></div><i>Fundada em {lead.foundedYear}</i></div>
    <div className="lead-detail-body">
      <main><DetailSection title="História da empresa"><p>{lead.companyStory}</p></DetailSection><DetailSection title="Momento atual"><p>{lead.currentMoment}</p></DetailSection><DetailSection title="Contexto da oportunidade"><p>{lead.publicHistory}</p></DetailSection><DetailSection title="Mapa de decisão"><div className="decision-map">{lead.contacts.map(contact=>contact.status==="unknown"?<div className="unknown-contact" key={contact.id}><span>?</span><div><b>{contact.nextAction}</b><small>Detalhes ainda não descobertos</small></div></div>:<div key={contact.id}><span className="avatar">{contact.name.split(" ").map(word=>word[0]).join("")}</span><div><b>{contact.name}</b><small>{contact.jobTitle} · {contact.department}</small><em>{contact.status==="mentioned"?"Mencionado":"Contato conhecido"} · {contact.relationship}</em></div><i>{contact.nextAction}</i></div>)}</div></DetailSection><DetailSection title="Necessidade conhecida"><div className="detail-highlight"><b>{lead.solution}</b><span>{lead.problem}.</span></div></DetailSection></main>
      <aside><h3>Contato principal</h3><div className="contact-card"><span className="avatar">{lead.name.split(" ").map(word=>word[0]).join("")}</span><strong>{lead.name}</strong><small>{lead.role}</small></div><dl><div><dt>Sócio fundador</dt><dd>{lead.founder}</dd></div><div><dt>Porte</dt><dd>{lead.companySize}</dd></div><div><dt>Perfil de comunicação</dt><dd>{lead.communicationStyle}</dd></div><div><dt>Papel na decisão</dt><dd>{lead.decisionPower}</dd></div><div><dt>Objeção já conhecida</dt><dd>{lead.visibleObjection}</dd></div></dl><div className="safe-data"><b>Ficha segura</b><span>Motivações e objeções ocultas devem ser descobertas na conversa.</span></div></aside>
    </div>
    <footer><button onClick={onClose}>Voltar à lista</button><button className="primary" onClick={onStart}>Abordar {lead.name.split(" ")[0]} →</button></footer>
  </section></div>;
}
function DetailSection({title,children}:{title:string;children:React.ReactNode}){return <section className="detail-section"><h3>{title}</h3>{children}</section>}
