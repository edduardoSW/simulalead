import { createProduct,emptyLocalData,migrateLocalData,type LocalData } from "./local-domain";
import type { LocalRepository } from "./local-repository";
import { supabase } from "./supabase-client";
import { createItTemplateCatalog } from "./it-template-catalog";

export class SupabaseRepository implements LocalRepository {
  private legacyConversations: Array<Record<string, unknown>> = [];
  private legacyOwnerId = "";
  private workspaceVersion = 0;
  private conversationVersions = new Map<string, number>();

  constructor(
    private organizationId: string,
    private userId: string,
    private organization: { name: string; ownerName: string; createdAt: string },
  ) {}

  async load() {
    const [{ data, error }, { data: simulations, error: simulationsError }] = await Promise.all([
      supabase.from("workspace_states").select("payload,updated_by,version").eq("organization_id", this.organizationId).maybeSingle(),
      supabase
        .from("user_simulations")
        .select("conversation_id,payload,updated_at,version")
        .eq("organization_id", this.organizationId)
        .eq("seller_id", this.userId)
        .order("updated_at", { ascending: false }),
    ]);
    if (error) throw new Error(error.message);
    if (simulationsError) throw new Error(simulationsError.message);
    this.conversationVersions = new Map((simulations || []).map((item) => [String(item.conversation_id), Number(item.version || 1)]));

    if (!data) {
      this.workspaceVersion = 0;
      const base = emptyLocalData();
      const product = createProduct({
        name: "Soluções e serviços de TI",
        description: "Serviços de tecnologia oferecidos pela organização.",
      });
      const catalog = createItTemplateCatalog(product);
      base.organization = {
        id: this.organizationId,
        name: this.organization.name,
        ownerName: this.organization.ownerName,
        segment: "Projetos e serviços de TI",
        trainingGoal: "Desenvolvimento comercial",
        createdAt: this.organization.createdAt,
      };
      const initial = {
        ...base,
        products: catalog.products,
        accounts: catalog.accounts,
        opportunities: catalog.opportunities,
        scenarios: catalog.scenarios,
      };
      await this.save(initial);
      return initial;
    }

    this.workspaceVersion = Number(data.version || 1);
    const workspacePayload = data.payload as Record<string, unknown>;
    this.legacyOwnerId = String(data.updated_by || "");
    this.legacyConversations = Array.isArray(workspacePayload.conversations)
      ? workspacePayload.conversations as Array<Record<string, unknown>>
      : [];
    const persistedConversations: Array<Record<string, unknown> & { sellerId: string }> = (simulations || []).map((item) => ({
        ...(item.payload as Record<string, unknown>),
        sellerId: this.userId,
      }));
    const persistedIds = new Set(persistedConversations.map((conversation) => String(conversation.id || "")));
    const compatibleLegacyConversations = this.legacyConversations
      .filter((conversation) => {
        const sellerId = String(conversation.sellerId || "");
        return sellerId === this.userId || (!sellerId && data.updated_by === this.userId);
      })
      .filter((conversation) => !persistedIds.has(String(conversation.id || "")))
      .map((conversation) => ({ ...conversation, sellerId: this.userId }));
    return migrateLocalData({
      ...workspacePayload,
      conversations: [...persistedConversations, ...compatibleLegacyConversations],
    });
  }

  async save(data: LocalData) {
    const ownedConversations = data.conversations
      .filter((conversation) => !conversation.sellerId || conversation.sellerId === this.userId)
      .map((conversation) => ({ ...conversation, sellerId: this.userId }));
    const { conversations: _conversations, ...sharedWorkspacePayload } = data;
    void _conversations;
    const preservedLegacyConversations = this.legacyConversations
      .map((conversation) => ({
        ...conversation,
        sellerId: String(conversation.sellerId || this.legacyOwnerId),
      }))
      .filter((conversation) => conversation.sellerId && conversation.sellerId !== this.userId);
    const workspacePayload = { ...sharedWorkspacePayload, conversations: preservedLegacyConversations };

    const { data: saved, error } = await supabase.rpc("save_workspace_and_simulations", {
      requested_workspace_payload: workspacePayload,
      requested_conversations: ownedConversations,
      requested_conversation_versions: Object.fromEntries(this.conversationVersions),
      expected_workspace_version: this.workspaceVersion,
    });
    if (error) {
      if (error.code === "40001" || /workspace changed|loaded version/i.test(error.message)) {
        throw new Error("Os dados foram alterados por outro usuário. Recarregue a página antes de tentar novamente.");
      }
      throw new Error(error.message);
    }
    const result = Array.isArray(saved) ? saved[0] : saved;
    const nextVersion = Number((result as { workspace_version?: number } | null)?.workspace_version);
    if (!Number.isFinite(nextVersion) || nextVersion < 1) throw new Error("O Supabase não confirmou a versão salva do workspace.");
    this.workspaceVersion = nextVersion;
    this.conversationVersions = new Map(ownedConversations.map((conversation) => [
      conversation.id,
      (this.conversationVersions.get(conversation.id) || 0) + 1,
    ]));
  }
}
