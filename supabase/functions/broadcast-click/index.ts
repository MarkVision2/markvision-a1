// Broadcast click tracker — публичный редирект коротких ссылок рассылки.
//
// В сообщение / кнопку подставляется ссылка вида
//   <SUPABASE_URL>/functions/v1/broadcast-click?t=<click_token>
// Переход фиксирует clicked_at у получателя (и статус 'clicked', если ещё не
// дальше по воронке) и делает 302 на target_url кампании.
//
// Публичная (verify_jwt=false) — по ней ходят клиенты из WhatsApp.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isHttpUrl(u: string | null | undefined): u is string {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}


function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Токен из ?t= или из последнего сегмента пути.
  const token =
    url.searchParams.get("t") ??
    url.pathname.split("/").filter(Boolean).pop() ??
    "";

  if (!token || token === "broadcast-click") {
    return new Response("Not found", { status: 404 });
  }

  const { data: rec } = await admin
    .from("broadcast_recipients")
    .select("id, status, campaign_id")
    .eq("click_token", token)
    .maybeSingle();

  const row = rec as { id: string; status: string; campaign_id: string } | null;
  if (!row) return new Response("Not found", { status: 404 });

  const { data: camp } = await admin
    .from("broadcast_campaigns")
    .select("target_url")
    .eq("id", row.campaign_id)
    .maybeSingle();
  const target = (camp as { target_url?: string } | null)?.target_url ?? null;

  // Фиксируем клик. Статус двигаем в 'clicked' только с ранних стадий,
  // чтобы не откатить replied/converted.
  const patch: Record<string, unknown> = { clicked_at: new Date().toISOString() };
  if (["sent", "delivered", "read"].includes(row.status)) patch.status = "clicked";
  await admin.from("broadcast_recipients").update(patch).eq("id", row.id);

  // Touch кампании — UI realtime / refetch подхватит клик.
  try {
    const { data: recs } = await admin
      .from("broadcast_recipients")
      .select("status, clicked_at, joined_at")
      .eq("campaign_id", row.campaign_id)
      .limit(50000);
    const rows = (recs ?? []) as { status: string; clicked_at: string | null; joined_at: string | null }[];
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    await admin.from("broadcast_campaigns").update({
      updated_at: new Date().toISOString(),
      stats: {
        total: rows.length,
        queued: count("queued"),
        sent: count("sent"),
        delivered: count("delivered"),
        read: count("read"),
        replied: count("replied"),
        converted: count("converted"),
        failed: count("failed"),
        optout: count("skipped_optout"),
        clicked: rows.filter((r) => !!r.clicked_at || !!r.joined_at).length,
        joined: rows.filter((r) => !!r.joined_at).length,
      },
    }).eq("id", row.campaign_id);
  } catch {
    /* non-fatal */
  }

  if (isHttpUrl(target)) return redirect(target);
  // Клик зафиксирован, но целевой ссылки нет — вежливая заглушка.
  return new Response("Спасибо! Ссылка недоступна.", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
