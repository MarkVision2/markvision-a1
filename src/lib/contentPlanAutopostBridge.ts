import { supabase } from "@/integrations/supabase/client";
import type { ContentPlanType } from "@/lib/contentPlan";

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
}): Promise<void> {
  const contentType = (["REELS", "CAROUSEL", "IMAGE", "STORIES"].includes(input.mediaType)
    ? input.mediaType
    : "REELS") as ContentPlanType;

  const title =
    (input.caption ?? "").trim().split("\n")[0]?.slice(0, 80) ||
    `${contentType} ${new Date(input.scheduledAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}`;

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
      .update({
        title,
        content_type: contentType,
        status: input.status ?? "scheduled",
        media_url: input.mediaUrl ?? null,
        thumbnail_url: input.thumbnailUrl ?? null,
        child_urls: input.childUrls ?? [],
        scheduled_at: input.scheduledAt,
        description: input.caption ?? null,
        post_instagram: true,
      } as never)
      .eq("id", (existing.data as { id: string }).id);
    return;
  }

  const { error } = await supabase.from("content_plan_items" as never).insert({
    project_id: input.projectId,
    title,
    category: "content",
    content_type: contentType,
    status: input.status ?? "scheduled",
    description: input.caption ?? null,
    media_url: input.mediaUrl ?? null,
    thumbnail_url: input.thumbnailUrl ?? null,
    child_urls: input.childUrls ?? [],
    scheduled_at: input.scheduledAt,
    autopost_id: input.autopostId,
    post_instagram: true,
  } as never);

  // Table may not exist yet — ignore silently; UI shows synthetic rows anyway.
  if (error && !/content_plan_items|does not exist|schema cache/i.test(error.message)) {
    console.warn("[content-plan] upsert from autopost:", error.message);
  }
}
