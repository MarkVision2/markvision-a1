/**
 * Semantic-ish matching of library B-roll assets to planned insert slots.
 * Filenames like IMG_9190 / RPReplay_* are treated as opaque (weak signal).
 */

const OPAQUE_NAME_RE =
  /^(img[_\-\s]?\d+|dsc[_\-\s]?\d+|rpreplay[_\-\s]?final\d+|reel[-_]?\d|asset|video|clip|movie|untitled|дизайн\s*без\s*названия|[0-9a-f]{16,})(\.[a-z0-9]+)?$/i;

const STOP = new Set([
  "и", "в", "на", "с", "по", "для", "это", "как", "что", "не", "а", "но", "же", "ли",
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "with", "from",
  "video", "clip", "mp4", "mov", "file", "final", "rpreplay", "untitled",
]);

/** Лёгкий RU↔EN мост для имён файлов медиатеки (без полного переводчика). */
const ALIASES = {
  отчет: ["report", "analytics", "dashboard", "otchet"],
  отчёт: ["report", "analytics", "dashboard", "otchet"],
  реклам: ["ads", "ad", "advert", "marketing", "reklama"],
  рекламе: ["ads", "ad", "advert", "marketing"],
  реклама: ["ads", "ad", "advert", "marketing"],
  инстаграм: ["instagram", "insta", "ig"],
  инстаграмма: ["instagram", "insta", "ig"],
  продажи: ["sales", "sell", "revenue"],
  продажа: ["sales", "sell"],
  деньг: ["money", "cash", "finance"],
  деньги: ["money", "cash"],
  клиент: ["client", "customer"],
  клиенты: ["clients", "customers"],
  воронк: ["funnel"],
  лид: ["lead", "leads"],
  лиды: ["leads", "lead"],
  сайт: ["website", "site", "web"],
  телефон: ["phone", "mobile", "call"],
  экран: ["screen", "desktop", "monitor"],
  дизайн: ["design", "ui", "layout"],
  dashboard: ["отчет", "отчёт", "analytics"],
  analytics: ["отчет", "отчёт", "аналитика"],
  instagram: ["инстаграм", "инста"],
  ads: ["реклама", "рекламе", "реклам"],
  report: ["отчет", "отчёт"],
  sales: ["продажи", "продажа"],
};

function expandToken(token) {
  const out = new Set([token]);
  const direct = ALIASES[token];
  if (direct) for (const a of direct) out.add(a);
  for (const [k, vals] of Object.entries(ALIASES)) {
    if (token.startsWith(k) || k.startsWith(token)) {
      out.add(k);
      for (const a of vals) out.add(a);
    }
  }
  return [...out];
}

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zа-яё0-9%]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

export function baseName(name) {
  const n = String(name || "").trim();
  const dot = n.lastIndexOf(".");
  return (dot > 0 ? n.slice(0, dot) : n).trim();
}

export function isOpaqueAssetName(name) {
  const base = baseName(name).replace(/\s+/g, " ").trim();
  if (!base) return true;
  const compact = base.replace(/\s/g, "");
  if (OPAQUE_NAME_RE.test(compact) || OPAQUE_NAME_RE.test(base)) return true;
  if (/дизайн\s*без\s*названия/i.test(base)) return true;
  // Pure hex / UUID filenames only (don't strip letters from real words).
  const hexOnly = compact.replace(/[^0-9a-f]/gi, "");
  if (
    hexOnly.length >= 16
    && hexOnly.length / Math.max(compact.length, 1) >= 0.85
  ) {
    return true;
  }
  const tokens = tokenize(base);
  return tokens.length === 0;
}

/** Overlap score between need text and asset name/metadata. */
export function scoreAssetAgainstNeed(asset, needText) {
  const needRaw = tokenize(needText);
  if (!needRaw.length) return 0;
  const need = [...new Set(needRaw.flatMap(expandToken))];
  const hayRaw = tokenize([
    asset?.name,
    asset?.folder_name,
    typeof asset?.metadata?.title === "string" ? asset.metadata.title : "",
    typeof asset?.metadata?.description === "string" ? asset.metadata.description : "",
    Array.isArray(asset?.metadata?.tags) ? asset.metadata.tags.join(" ") : "",
  ].filter(Boolean).join(" "));
  if (!hayRaw.length) return 0;
  const hay = [...new Set(hayRaw.flatMap(expandToken))];
  let hits = 0;
  for (const t of need) {
    if (hay.includes(t)) hits += 1;
    else if (hay.some((h) => {
      if (h.length < 5 || t.length < 5) return false;
      const longer = h.length >= t.length ? h : t;
      const shorter = h.length >= t.length ? t : h;
      // avoid market≈marketing false friends
      if (longer.length - shorter.length > 2) return false;
      return longer.startsWith(shorter);
    })) {
      hits += 0.5;
    }
  }
  let score = Math.min(1, hits / Math.max(needRaw.length, 1));
  if (isOpaqueAssetName(asset?.name)) score *= 0.15;
  return score;
}

/**
 * Pick best unused asset for a slot.
 * @returns {{ asset: object|null, score: number, reason: string }}
 */
export function pickLibraryAsset(assets, usedIds, needText, { minScore = 0.2 } = {}) {
  const free = (assets || []).filter((a) => a?.id && !usedIds.has(a.id));
  if (!free.length) return { asset: null, score: 0, reason: "empty" };

  let best = null;
  let bestScore = -1;
  for (const asset of free) {
    const score = scoreAssetAgainstNeed(asset, needText);
    if (score > bestScore) {
      best = asset;
      bestScore = score;
    }
  }

  if (best && bestScore >= minScore) {
    return { asset: best, score: bestScore, reason: "semantic" };
  }

  // No grounded name match — prefer opaque round-robin over inventing stock.
  // Meaningful-named leftovers without overlap stay for later slots that might match.
  const opaque = free.filter((a) => isOpaqueAssetName(a.name));
  const pool = opaque.length ? opaque : free;
  const pick = pool[0];
  return {
    asset: pick,
    score: bestScore > 0 ? bestScore : 0,
    reason: opaque.length ? "opaque-pool" : "fallback-pool",
  };
}

/** Reject Pexels queries that are too generic or empty of concrete nouns. */
export function isWeakStockQuery(query) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 3) return true;
  const weak = new Set([
    "business", "office", "people", "person", "man", "woman", "work", "working",
    "success", "motivation", "lifestyle", "abstract", "technology", "tech",
    "marketing", "corporate", "meeting", "handshake", "city", "nature",
  ]);
  const tokens = tokenize(q);
  if (!tokens.length) return true;
  if (tokens.every((t) => weak.has(t))) return true;
  return false;
}
