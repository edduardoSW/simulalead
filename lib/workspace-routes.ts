export type WorkspaceSection="home"|"opportunities"|"conversations"|"scenarios"|"leads"|"evaluations"|"settings";

export const workspaceRoutes:{section:WorkspaceSection;label:string;path:string;aliases:string[]}[]=[
  {section:"home",label:"Visão geral",path:"/home",aliases:[]},
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

const workspaceIdentifierPattern = /^[A-Za-z0-9:_-]{1,160}$/;
const workspaceStoragePrefix = "simulaLead:last-workspace-location:";
export type WorkspaceLocationScope = { conversationIds:ReadonlySet<string>; scenarioIds:ReadonlySet<string> };

export function workspaceLocationStorageKey(userId:string){return `${workspaceStoragePrefix}${userId}`}

export function sanitizeWorkspaceLocation(value:string,scope?:WorkspaceLocationScope){
  let url:URL;try{url=new URL(value,"https://simulalead.local")}catch{return null}
  const section=sectionFromPath(url.pathname);if(!section)return null;
  const base=pathForSection(section);
  if(section==="conversations"){
    const id=url.searchParams.get("conversation");
    if(id&&workspaceIdentifierPattern.test(id)&&(!scope||scope.conversationIds.has(id)))return `${base}?conversation=${encodeURIComponent(id)}`;
  }
  if(section==="scenarios"){
    const id=url.searchParams.get("training");
    if(id&&workspaceIdentifierPattern.test(id)&&(!scope||scope.scenarioIds.has(id)))return `${base}?training=${encodeURIComponent(id)}`;
  }
  return base;
}

export function readLastWorkspaceLocation(storage:Pick<Storage,"getItem">,userId:string){
  try{const value=storage.getItem(workspaceLocationStorageKey(userId));return value?sanitizeWorkspaceLocation(value):null}catch{return null}
}
export function saveLastWorkspaceLocation(storage:Pick<Storage,"setItem">,userId:string,value:string){
  const safe=sanitizeWorkspaceLocation(value);if(!safe)return null;
  try{storage.setItem(workspaceLocationStorageKey(userId),safe)}catch{/* Navigation still works when storage is unavailable. */}return safe;
}
export function clearLastWorkspaceLocation(storage:Pick<Storage,"removeItem">,userId:string){
  try{storage.removeItem(workspaceLocationStorageKey(userId))}catch{/* Logout continues when storage is unavailable. */}
}
export function resolveWorkspaceLocation(current:string,saved:string|null,scope:WorkspaceLocationScope){
  const currentSafe=sanitizeWorkspaceLocation(current,scope),savedSafe=saved?sanitizeWorkspaceLocation(saved,scope):null;
  if(!currentSafe)return savedSafe||pathForSection("home");
  if(currentSafe===pathForSection("home")&&savedSafe&&savedSafe!==pathForSection("home"))return savedSafe;
  return currentSafe;
}
