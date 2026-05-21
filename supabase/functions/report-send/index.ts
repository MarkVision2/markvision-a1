import { requireUser, userHasRole } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");

    const body = await req.json();
    const { subscription_id, test } = body ?? {};

    if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Telegram-бот не подключён. Подключите коннектор Telegram в настройках проекта.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Read subscription
    const subResp = await fetch(
      `${SUPABASE_URL}/rest/v1/report_subscriptions?id=eq.${subscription_id}&select=*`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
    );
    const rows = await subResp.json();
    const sub = Array.isArray(rows) ? rows[0] : null;
    if (!sub) throw new Error("Подписка не найдена");

    // Ownership check — prevent IDOR: only the owner or an admin can trigger send.
    const isAdmin = await userHasRole(auth.userId, "admin");
    if (sub.created_by !== auth.userId && !isAdmin) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = test
      ? `🧪 *Тестовое сообщение*\nПодписка «${sub.name}» подключена. Отчёты будут приходить в ${String(sub.send_hour).padStart(2, "0")}:00.`
      : `📊 *Отчёт «${sub.name}»*\nПериод: ${sub.period}\n\nОткройте полный отчёт в приложении.`;

    const tg = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: sub.chat_id,
        text,
        parse_mode: "Markdown",
      }),
    });
    const tgJson = await tg.json();
    if (!tg.ok) {
      return new Response(JSON.stringify({ ok: false, error: tgJson?.description ?? "Telegram error" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!test) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/report_subscriptions?id=eq.${subscription_id}`,
        {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ last_sent_at: new Date().toISOString() }),
        },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Unknown" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});