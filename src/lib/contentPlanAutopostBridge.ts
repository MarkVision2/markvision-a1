import { supabase } from "@/integrations/supabase/client";
import type { ContentPlanCategory, ContentPlanType } from "@/lib/contentPlan";

/** After scheduling via Autopost — mirror row into content_plan_items (best-effort). */
export async function upsertContentPlanFromAutopost(input: {
  projectId: string;
  autopostId: string;
  mediaType: string;
  caption?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  childUrls?: string[] | null;
  scheduledAt: string;
  status?: "scheduled" | "published" | "error";
  /** Plan metadata (from unified Content Plan composer). */
  title?: string | null;
  category?: ContentPlanCategory | null;
  codeword?: string | null;
  hashtags?: string | null;
  description?: string | null;
  prompts?: string | null;
}): Promise<void> {
  const contentType = (["REELS", "CAROUSEL", "IMAGE", "STORIES"].includes(input.mediaType)
    ? input.mediaType
    : "REELS") as ContentPlanType;

  const title =
    (input.title ?? "").trim().slice(0, 120) ||
    (input.caption ?? "").trim().split("\n")[0]?.slice(0, 80) ||
    `${contentType} ${new Date(input.scheduledAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}`;

  const description = (input.description ?? input.caption ?? null)?.trim() || null;
  const category = input.category ?? "content";
  const codeword = (input.codeword ?? "").trim().toLowerCase() || null;
  const hashtags = (input.hashtags ?? "").trim() || null;
  const prompts = (input.prompts ?? "").trim() || null;

  const row = {
    title,
    category,
    content_type: contentType,
    status: input.status ?? "scheduled",
    media_url: input.mediaUrl ?? null,
    thumbnail_url: input.thumbnailUrl ?? null,
    child_urls: input.childUrls ?? [],
    scheduled_at: input.scheduledAt,
    description,
    hashtags,
    prompts,
    codeword,
    post_instagram: true,
  };

  // If already linked — update
  const existing = await supabase
    .from("content_plan_items" as never)
    .select("id")
    .eq("project_id", input.projectId)
    .eq("autopost_id", input.autopostId)
    .maybeSingle();

  if ((existing.data as { id?: string } | null)?.id) {
    await supabase
      .from("content_plan_items" as never)
      .update(row as never)
      .eq("id", (existing.data as { id: string }).id);
    return;
  }

  const { error } = await supabase.from("content_plan_items" as never).insert({
    project_id: input.projectId,
    autopost_id: input.autopostId,
    ...row,
  } as never);

  // Table may not exist yet — ignore silently; UI shows synthetic rows anyway.
  if (error && !/content_plan_items|does not exist|schema cache/i.test(error.message)) {
    console.warn("[content-plan] upsert from autopost:", error.message);
  }
}
