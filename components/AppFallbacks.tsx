import Link from "next/link";

export function LoadingScreen({text="Carregando"}:{text?:string}){
  return <main className="page-loader" aria-live="polite" aria-busy="true"><div className="brand"><span className="brand-mark">S</span><span>simulaLEAD</span></div><div className="loader-orbit"><span/><span/><span/></div><p>{text}</p></main>;
}

export function StartupErrorScreen({title="Não foi possível iniciar",message,actionLabel="Tentar novamente",onAction}:{title?:string;message:string;actionLabel?:string;onAction?:()=>void}){
  return <main className="startup-fallback"><section><div className="brand"><span className="brand-mark">S</span><span>simulaLEAD</span></div><p className="eyebrow">INICIALIZAÇÃO</p><h1>{title}</h1><p>{message}</p>{onAction&&<button className="primary" onClick={onAction}>{actionLabel}</button>}</section></main>;
}

export function NotFoundScreen(){
  return <main className="startup-fallback"><section><div className="brand"><span className="brand-mark">S</span><span>simulaLEAD</span></div><p className="eyebrow">404</p><h1>Página não encontrada.</h1><p>Essa rota não faz parte do sistema.</p><Link className="primary" href="/">Voltar para o início</Link></section></main>;
}
