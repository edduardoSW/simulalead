import { createProduct,emptyLocalData,migrateLocalData,type LocalData } from "./local-domain";
import type { LocalRepository } from "./local-repository";
import { supabase } from "./supabase-client";
import { createItTemplateCatalog } from "./it-template-catalog";

export class SupabaseRepository implements LocalRepository {
  private legacyConversations: Array<Record<string, unknown>> = [];

  constructor(
    private organizationId: string,
    private userId: string,
    private organization: { name: string; ownerName: string; createdAt: string },
  ) {}

  async load() {
    const [{ data, error }, { data: simulations, error: simulationsError }] = await Promise.all([
      supabase.from("workspace_states").select("payload,updated_by").eq("organization_id", this.organizationId).maybeSingle(),
      supabase
        .from("user_simulations")
        .select("payload,updated_at")
        .eq("organization_id", this.organizationId)
        .eq("seller_id", this.userId)
        .order("updated_at", { ascending: false }),
    ]);
    if (error) throw new Error(error.message);
    if (simulationsError) throw new Error(simulationsError.message);

    if (!data) {
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

    const workspacePayload = data.payload as Record<string, unknown>;
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
    const now = new Date().toISOString();
    const ownedConversations = data.conversations
      .filter((conversation) => !conversation.sellerId || conversation.sellerId === this.userId)
      .map((conversation) => ({ ...conversation, sellerId: this.userId }));
    const { conversations: _conversations, ...sharedWorkspacePayload } = data;
    void _conversations;
    const workspacePayload = { ...sharedWorkspacePayload, conversations: this.legacyConversations };

    const { error } = await supabase.from("workspace_states").upsert({
      organization_id: this.organizationId,
      payload: workspacePayload,
      updated_by: this.userId,
      updated_at: now,
    });
    if (error) throw new Error(error.message);

    if (ownedConversations.length) {
      const { error: conversationError } = await supabase.from("user_simulations").upsert(
        ownedConversations.map((conversation) => ({
          organization_id: this.organizationId,
          seller_id: this.userId,
          conversation_id: conversation.id,
          payload: conversation,
          updated_at: conversation.updatedAt || now,
        })),
        { onConflict: "seller_id,conversation_id" },
      );
      if (conversationError) throw new Error(conversationError.message);
    }
  }
}
