import { notFound } from "next/navigation";
import { SupabaseWorkspace } from "../../components/SupabaseWorkspace";
import { sectionFromSlug,validWorkspaceSlugs } from "../../lib/workspace-routes";

export function generateStaticParams(){
  return validWorkspaceSlugs.map(section=>({section}));
}

export default async function WorkspaceSectionPage({params}:{params:Promise<{section:string}>}){
  const {section:slug}=await params;
  const section=sectionFromSlug(slug);
  if(!section)notFound();
  return <SupabaseWorkspace initialSection={section}/>;
}
