-- Synthetic local-development data only. No real person or auth.users row is created.
begin;

insert into public.organizations (id, name, slug)
values ('10000000-0000-0000-0000-000000000001', 'Acme Treinamentos Sintéticos', 'acme-treinamentos-sinteticos')
on conflict (id) do nothing;

insert into public.products (id, organization_id, name, description, value_proposition, target_audience, key_benefits, common_objections, competitors, sales_guidelines)
values (
  '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'FlowDesk CRM',
  'CRM fictício para organizar contatos, oportunidades e tarefas comerciais.',
  'Centraliza o processo comercial e reduz perda de oportunidades.', 'Pequenas e médias equipes B2B',
  '["pipeline visual","automação de tarefas","relatórios"]', '["preço","tempo de implantação","adoção da equipe"]',
  '["Nimbo CRM","VendaBox"]', 'Investigar o processo atual antes de apresentar funcionalidades.'
) on conflict (id) do nothing;

insert into public.competencies (id, organization_id, code, name, description) values
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','qualification','Qualificação','Entende contexto, necessidade, autoridade e prazo.'),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','active_listening','Escuta ativa','Demonstra compreensão e aprofunda respostas.'),
('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','objection_handling','Tratamento de objeções','Investiga e responde objeções sem pressão indevida.'),
('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','value_communication','Comunicação de valor','Relaciona benefícios às necessidades descobertas.'),
('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','closing','Fechamento','Propõe próximo passo claro e adequado.')
on conflict (id) do nothing;

insert into public.evaluation_rubrics (id, organization_id, rubric_key, name, version, description, minimum_score, status)
values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000099','Rubrica comercial padrão',1,'Avaliação equilibrada das competências essenciais.',60,'active')
on conflict (id) do nothing;

insert into public.rubric_criteria (id,rubric_id,competency_id,name,description,scoring_guidance,weight,display_order) values
('41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Diagnóstico','Investiga situação, problema, impacto e processo decisório.','0: não investiga; 50: investigação parcial; 100: diagnóstico completo e natural.',25,1),
('41000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','Escuta e adaptação','Usa as respostas do lead para orientar a conversa.','0: ignora; 50: reconhece; 100: sintetiza e aprofunda.',20,2),
('41000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','Objeções','Explora a causa e responde com relevância.','0: confronta/ignora; 50: responde genericamente; 100: valida, investiga e resolve.',20,3),
('41000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','Valor','Conecta a solução ao impacto desejado.','0: lista recursos; 50: benefício genérico; 100: valor específico e comprovável.',20,4),
('41000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005','Próximo passo','Obtém compromisso claro e coerente.','0: sem avanço; 50: sugestão vaga; 100: compromisso com responsável e data.',15,5)
on conflict (id) do nothing;

insert into public.lead_profiles
(id,organization_id,name,age_range,job_title,business_segment,company_size,company_context,personality,communication_style,pain_points,needs,visible_objections,hidden_objections,buying_motivations,decision_criteria,competitors_considered,budget_context,urgency_level,decision_power,initial_interest_level,difficulty_level,behavior_instructions,reveal_conditions,acceptance_conditions,refusal_conditions,source_type) values
('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Renata Custo','30-39','Gerente comercial','Serviços B2B','20-49','Pipeline em planilhas','Cautelosa','Analítica e cordial','["oportunidades esquecidas"]','["previsibilidade"]','["investimento alto"]','["receio de custo de implantação"]','["reduzir perdas"]','["retorno em até seis meses"]','[]','Orçamento restrito; não informa valor sem diagnóstico.',3,4,3,'beginner','Questione o preço, mas fique receptiva a cálculo de retorno.','["Revelar prazo ao ouvir pergunta sobre impacto"]','["Aceitar demonstração se houver relação clara entre custo e perda"]','["Recusar pressão por fechamento imediato"]','synthetic'),
('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Caio Objetivo','40-49','Diretor de operações','Logística','50-199','Já teve implantação frustrada','Desconfiado','Direto e breve','["baixa adesão ao sistema atual"]','["implantação segura"]','["não acredito em promessa de software"]','["medo de repetir o fracasso"]','["controle operacional"]','["prova e plano de adoção"]','[]',null,2,5,2,'advanced','Responda em frases curtas e exija evidências.','["Revelar experiência anterior após validação sem defensividade"]','["Aceitar diagnóstico técnico quando houver plano concreto"]','["Recusar respostas vagas ou exageradas"]','synthetic'),
('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Lia Pressa','25-34','Head de vendas','Tecnologia','10-19','Equipe cresceu rapidamente','Impaciente','Rápida e pragmática','["gestão perdeu visibilidade"]','["começar rápido"]','["não tenho tempo para reunião longa"]','[]','["organizar crescimento"]','["implantação em poucos dias"]','[]',null,5,5,4,'intermediate','Interrompa rodeios e peça síntese.','["Revelar meta se receber pergunta direta"]','["Aceitar agenda de 20 minutos com objetivo claro"]','["Encerrar se houver apresentação longa"]','synthetic'),
('50000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Bruno Comparador','35-44','Coordenador comercial','Educação corporativa','20-49','Selecionando novo CRM','Metódico','Questionador','["relatórios manuais"]','["comparar opções"]','["o concorrente tem mais integrações"]','["preferência inicial pelo Nimbo CRM"]','["decisão defensável"]','["aderência e suporte"]','["Nimbo CRM","VendaBox"]',null,3,3,3,'intermediate','Compare critérios, não aceite ataques a concorrentes.','["Revelar preferência após pergunta sobre critérios"]','["Aceitar prova guiada por casos de uso"]','["Recusar desqualificação genérica de concorrentes"]','synthetic'),
('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Nina Influenciadora','30-39','Analista de revenue operations','SaaS','50-199','Mapeia soluções para o comitê','Colaborativa','Detalhista','["dados fragmentados"]','["preparar recomendação"]','["preciso envolver a diretoria"]','["CFO exige caso financeiro"]','["ganhar eficiência"]','["segurança, ROI e adoção"]','[]',null,3,2,4,'advanced','Demonstre interesse, mas deixe claro que não decide.','["Revelar composição do comitê após pergunta sobre decisão"]','["Aceitar reunião com decisores se receber material adequado"]','["Recusar tentativa de fechar diretamente"]','synthetic')
on conflict (id) do nothing;

insert into public.training_scenarios
(id,organization_id,product_id,lead_profile_id,evaluation_rubric_id,title,description,conversation_context,training_objective,difficulty_level,success_conditions,failure_conditions,maximum_messages,time_limit_minutes,attempt_limit,system_instructions) values
('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Valor antes do desconto','Lead inbound pediu preço.','Primeira conversa após formulário.','Diagnosticar impacto e tratar objeção de preço.','beginner','["diagnóstico realizado","demonstração aceita"]','["desconto sem diagnóstico","pressão indevida"]',24,20,3,'Interprete apenas Renata; não revele orçamento espontaneamente.'),
('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','Reconquistar confiança','Prospecção após experiência ruim.','Caio aceitou uma conversa curta.','Construir confiança e conseguir diagnóstico técnico.','advanced','["experiência anterior compreendida","diagnóstico aceito"]','["promessas sem evidência"]',20,15,2,'Interprete apenas Caio; seja breve e cético.'),
('60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','Pitch em pouco tempo','Lead dispõe de poucos minutos.','Contato em evento, chamada imediata.','Qualificar e agendar conversa objetiva.','intermediate','["prioridade identificada","reunião curta agendada"]','["fala longa","perda de foco"]',14,8,3,'Interprete apenas Lia; cobre objetividade.'),
('60000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000004','Concorrência em avaliação','Lead compara três fornecedores.','Meio do processo de seleção.','Descobrir critérios e diferenciar com ética.','intermediate','["critérios priorizados","prova agendada"]','["ataque a concorrente","comparação genérica"]',26,25,3,'Interprete apenas Bruno; peça comparação baseada em critérios.'),
('60000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000005','Mapear o comitê','Contato interessado sem autoridade final.','Descoberta com influenciadora interna.','Mapear decisão e conquistar acesso ao comitê.','advanced','["processo decisório mapeado","reunião com decisores"]','["tentar fechar com não decisora"]',28,25,2,'Interprete apenas Nina; não assuma autoridade de compra.')
on conflict (id) do nothing;

commit;

