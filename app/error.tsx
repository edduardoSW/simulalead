"use client";
import { useEffect } from "react";
import { StartupErrorScreen } from "../components/AppFallbacks";

export default function Error({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
  useEffect(()=>{console.error("[simulaLEAD] Erro de renderização.",{message:error.message,digest:error.digest})},[error]);
  return <StartupErrorScreen title="Erro ao abrir o sistema" message="A aplicação encontrou um erro durante a inicialização. Tente recarregar a tela." onAction={reset}/>;
}
