export type WorkspaceSection="home"|"opportunities"|"conversations"|"scenarios"|"leads"|"evaluations"|"settings";

export const workspaceRoutes:{section:WorkspaceSection;label:string;path:string;aliases:string[]}[]=[
  {section:"home",label:"Visão geral",path:"/",aliases:["/home"]},
  {section:"opportunities",label:"Oportunidades",path:"/oportunidades",aliases:["/opportunities"]},
  {section:"conversations",label:"Conversas",path:"/conversas",aliases:["/conversations"]},
  {section:"scenarios",label:"Treinamentos",path:"/treinamentos",aliases:["/scenarios"]},
  {section:"leads",label:"Leads",path:"/leads",aliases:[]},
  {section:"evaluations",label:"Avaliações",path:"/avaliacoes",aliases:["/evaluations"]},
  {section:"settings",label:"Configurações",path:"/configuracoes",aliases:["/settings"]},
];

export const validWorkspaceSlugs=workspaceRoutes.flatMap(route=>[route.path,...route.aliases].map(path=>path.replace(/^\//,""))).filter(Boolean);

export function sectionFromPath(pathname:string):WorkspaceSection|null{
  const normalized=normalizePath(pathname);
  return workspaceRoutes.find(route=>route.path===normalized||route.aliases.includes(normalized))?.section??null;
}

export function sectionFromSlug(slug:string):WorkspaceSection|null{
  return sectionFromPath(`/${slug}`);
}

export function pathForSection(section:WorkspaceSection):string{
  return workspaceRoutes.find(route=>route.section===section)?.path??"/";
}

function normalizePath(pathname:string):string{
  const path=pathname.split("?")[0]?.split("#")[0]||"/";
  if(path==="/"||path==="")return "/";
  return `/${path.replace(/^\/+|\/+$/g,"")}`;
}
