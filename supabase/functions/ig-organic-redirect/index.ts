// Public short-link redirect for Instagram organic code-words.
//
// Flow:
//   1. Пользователь под Reels пишет код-слово в DM (или в комменты).
//   2. Бот / n8n отвечает ссылкой вида:
//        https://<PROJECT>.functions.supabase.co/ig-organic-redirect?c=<short_id>&u=<username>
//   3. Эта функция:
//        - резолвит short_id в codeword + target_url,
//        - пишет событие link_click в instagram_organic_events,
//        - 302-редиректит на target_url с дописанными UTM
//          (utm_source=instagram&utm_medium=organic&utm_campaign=<codeword>&cw=<codeword>).
//   4. Хидден-поле `cw` на форме landing-страницы попадает в lead-intake →
//      замыкаем атрибуцию «лид ← код-слово ← рилс».
//
// Endpoints:
//   GET /functions/v1/ig-organic-redirect?c=<short_id>&u=<username>
//
// Query params:
//   c   — short_id код-слова (обязателен)
//   u   — username/контакт автора DM (опционален, используется для дедупа)
//   ref — произвольный реферал (опционален)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
  });
}

function safeAppendParams(rawUrl: string, params: Record<string, string>): string {
  try {
    const u = new URL(rawUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    // target_url мог оказаться битым — отдадим как есть, пусть браузер сам ругается.
    return rawUrl;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  const url = new URL(req.url);
  const short = (url.searchParams.get("c") || "").trim();
  const username = (url.searchParams.get("u") || "").trim() || null;
  const ref = (url.searchParams.get("ref") || "").trim() || null;

  if (!short) {
    return html("<h1>404</h1><p>Bad link</p>", 404);
  }

  const { data: rows, error: rpcErr } = await admin.rpc("resolve_codeword_short", {
    p_short: short,
  });
  if (rpcErr) {
    console.error("[ig-organic-redirect] rpc failed", rpcErr);
    return html("<h1>500</h1><p>Server error</p>", 500);
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    return html("<h1>404</h1><p>Code-word not found</p>", 404);
  }
  if (!row.active) {
    return html("<h1>410</h1><p>This link is inactive</p>", 410);
  }
  if (!row.target_url) {
    return html("<h1>404</h1><p>No target URL configured</p>", 404);
  }

  const occurredAt = new Date();
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(occurredAt);

  // Fire-and-record: пишем событие, но не валим редирект, если БД упала.
  const { error: insertErr } = await admin.from("instagram_organic_events").insert({
    project_id: row.project_id,
    codeword_id: row.id,
    codeword: row.codeword,
    reel_id: row.reel_id,
    reel_url: row.reel_url,
    event_type: "link_click",
    username,
    contact: null,
    lead_id: null,
    date: dateKey,
    occurred_at: occurredAt.toISOString(),
    payload: {
      via: "ig-organic-redirect",
      short_id: short,
      ref,
      user_agent: req.headers.get("user-agent") ?? null,
      referer: req.headers.get("referer") ?? null,
    },
  });
  if (insertErr) {
    console.error("[ig-organic-redirect] event insert failed", insertErr);
  }

  const target = safeAppendParams(row.target_url, {
    utm_source: "instagram",
    utm_medium: "organic",
    utm_campaign: row.codeword,
    cw: row.codeword,
    ...(username ? { ref: username } : {}),
  });

  return new Response(null, {
    status: 302,
    headers: {
      ...cors,
      Location: target,
      "Cache-Control": "no-store",
    },
  });
});
