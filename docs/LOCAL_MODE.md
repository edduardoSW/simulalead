# Modo local

Esta etapa usa IndexedDB como persistência temporária. A interface acessa `LocalApplicationService`, que depende apenas do contrato `LocalRepository`; o adaptador atual é `IndexedDbRepository`. Um futuro adaptador Supabase poderá implementar o mesmo contrato sem alterar as telas ou regras de negócio.

## Backup

Em **Configurações**, use **Exportar JSON**. O arquivo contém `format`, `version`, data de exportação e os dados locais. Para restaurar, use **Importar JSON** e confirme a substituição. Arquivos inválidos, corrompidos ou de versão incompatível são recusados.

## Limitações

- Não há sincronização entre dispositivos.
- Não há colaboração real entre usuários.
- Não há autenticação segura nem isolamento multiempresa no servidor.
- Limpar os dados do navegador é irreversível sem backup.
- Notificações existem apenas neste dispositivo.
- O modo é adequado para protótipo avançado, testes e uso individual, não para operação corporativa multiusuário.

As migrations existentes foram preservadas como histórico de trabalho, mas não são usadas nem executadas pelo modo local.
