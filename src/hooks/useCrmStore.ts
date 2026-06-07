import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate, TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { fetchPendingAdvances, markAdvanceDone } from "@/integrations/clientConfig/client";
import { markAutoMoved } from "@/lib/autoMoveTracker";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type {
  ChatMessage,
  Lead,
  LeadEvent,
  LeadEventType,
  LeadStage,
  PaymentMethod,
  UtmTags,
  WhatsAppConfig,
} from "@/types/crm";

// UTM сохраняется в localStorage до создания лида (анонимная сессия) — это ОК.
const UTM_KEY = "crm.utm.lasttouch.v1";

function readUtmFromUrl(): { utm?: UtmTags; referrer?: string; landingUrl?: string; firstTouchAt?: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const utm: UtmTags = {};
  const map: Array<[keyof UtmTags, string]> = [
    ["source", "utm_source"], ["medium", "utm_medium"],
    ["campaign", "utm_campaign"], ["content", "utm_content"], ["term", "utm_term"],
  ];
  for (const [k, p] of map) { const v = params.get(p); if (v) utm[k] = v; }
  if (Object.keys(utm).length === 0) return null;
  return {
    utm,
    referrer: document.referrer || undefined,
    landingUrl: window.location.href,
    firstTouchAt: new Date().toISOString(),
  };
}

export function getLastTouch() {
  const fresh = readUtmFromUrl();
  if (fresh) {
    try { localStorage.setItem(UTM_KEY, JSON.stringify(fresh)); } catch { /* noop */ }
    return fresh;
  }
  try {
    const raw = localStorage.getItem(UTM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export const DEFAULT_STAGES: LeadStage[] = [
  { id: "new", title: "Новая", color: "primary", icon: "zap" },
  { id: "no_answer", title: "Без ответа", color: "warning", icon: "bell" },
  { id: "in_progress", title: "В работе", color: "primary", icon: "message" },
  { id: "invoice", title: "Счёт", color: "warning", icon: "card" },
  { id: "scheduled", title: "Записан", color: "primary", icon: "calendar" },
  { id: "visit", title: "Визит", color: "success", icon: "map" },
  { id: "paid", title: "Оплачен", color: "success", icon: "check" },
  { id: "rejected", title: "Отказ", color: "destructive", icon: "ban" },
];


type LeadRow = {
  id: string; pipeline_id: string; stage_id: string;
  name: string; phone: string; email: string | null;
  source: string; campaign: string | null; channel: string | null;
  amount: number | string; ai_score: number; note: string | null;
  service: string | null; city: string | null; age: number | null;
  utm: Record<string, string> | null; referrer: string | null; landing_url: string | null;
  first_touch_at: string | null; first_response_at: string | null;
  last_contact_at: string | null; next_visit_at: string | null;
  paid: boolean; paid_at: string | null; payment_method: string | null;
  rejected_at: string | null; reject_reason: string | null;
  pinned: boolean; assigned_to: string | null; created_by: string | null;
  created_at: string; updated_at: string; last_activity_at: string;
  cabinet_id?: string | null;
  meta_ad_id?: string | null; meta_adset_id?: string | null; meta_campaign_id?: string | null;
  is_personal?: boolean | null;
};

type CommRow = {
  id: string; lead_id: string; type: string; direction: string | null;
  channel: string | null; content: string | null; status: string | null;
  template_key: string | null; is_draft: boolean; is_auto: boolean;
  created_by: string | null; created_at: string;
};

type EventRow = {
  id: string; lead_id: string | null; event_type: string;
  payload: Record<string, unknown> | null; actor_id: string | null; created_at: string;
};

type TaskRow = {
  id: string; lead_id: string; title: string; due_at: string;
  status: string; done_at: string | null;
};

type DealRow = {
  id: string; lead_id: string; amount: number | string; status: string;
  payment_method: string | null; paid_at: string | null;
};

type StageHistRow = {
  id: string; lead_id: string; from_stage_id: string | null;
  to_stage_id: string; changed_at: string;
};


function commToChat(r: CommRow): ChatMessage {
  const isCall = r.type === "call";
  const fromMe = r.direction === "out";
  return {
    id: r.id,
    leadId: r.lead_id,
    fromMe,
    text: r.content ?? "",
    at: r.created_at,
    kind: isCall ? "call" : "message",
    channel: (r.channel as ChatMessage["channel"]) ?? undefined,
    status: (r.status as ChatMessage["status"]) ?? undefined,
    callStatus: isCall
      ? (r.status === "missed" ? "missed" : (r.direction === "in" ? "incoming" : "outgoing"))
      : undefined,
    templateKey: r.template_key ?? undefined,
  };
}

function leadRowToFrontIndexed(
  r: LeadRow,
  idToKey: Map<string, string>,
  eventsByLead: Map<string, EventRow[]>,
  tasksByLead: Map<string, TaskRow[]>,
  historyByLead: Map<string, StageHistRow[]>,
): Lead {
  const evs = eventsByLead.get(r.id) ?? [];
  const tks = tasksByLead.get(r.id) ?? [];
  const hist = historyByLead.get(r.id) ?? [];
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email ?? undefined,
    source: r.source,
    stageId: idToKey.get(r.stage_id) ?? "new",
    amount: Number(r.amount ?? 0),
    aiScore: r.ai_score,
    note: r.note ?? undefined,
    utm: (r.utm as UtmTags) ?? undefined,
    referrer: r.referrer ?? undefined,
    landingUrl: r.landing_url ?? undefined,
    firstTouchAt: r.first_touch_at ?? undefined,
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at,
    assigneeId: r.assigned_to ?? undefined,
    rejectReason: (r.reject_reason as Lead["rejectReason"]) ?? undefined,
    rejectedAt: r.rejected_at ?? undefined,
    pinned: r.pinned,
    firstResponseAt: r.first_response_at ?? undefined,
    channel: (r.channel as Lead["channel"]) ?? undefined,
    cabinetId: r.cabinet_id ?? undefined,
    metaAdId: r.meta_ad_id ?? undefined,
    metaAdsetId: r.meta_adset_id ?? undefined,
    metaCampaignId: r.meta_campaign_id ?? undefined,
    isPersonal: r.is_personal ?? false,
    service: r.service ?? undefined,
    city: r.city ?? undefined,
    age: r.age ?? undefined,
    nextVisitAt: r.next_visit_at ?? undefined,
    paid: r.paid,
    paymentMethod: (r.payment_method as PaymentMethod) ?? undefined,
    paidAt: r.paid_at ?? undefined,
    diagnosticAmount: Number((r as unknown as { diagnostic_amount?: number }).diagnostic_amount ?? 0),
    stageHistory: hist.map((h) => ({
      stageId: idToKey.get(h.to_stage_id) ?? "new",
      at: h.changed_at,
    })),
    tasks: tks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.due_at,
      doneAt: t.done_at ?? undefined,
    })),
    events: evs.map((e) => ({
      id: e.id,
      type: e.event_type as LeadEventType,
      at: e.created_at,
      payload: (e.payload as LeadEvent["payload"]) ?? undefined,
    })),
  };
}

export function useCrmStore() {
  const { user } = useAuth();
  const { config: whatsapp, setWhatsapp } = useWhatsAppConfig();
  const { activeId: projectId } = useProjectsStore();

  const [stages, setStages] = useState<LeadStage[]>(DEFAULT_STAGES);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const projectIdRef = useRef(projectId);

  useEffect(() => {
    projectIdRef.current = projectId;
    setLeads([]);
    setChats([]);
  }, [projectId]);

  // bidirectional maps stage key <-> uuid
  const [stageIdMap, setStageIdMap] = useState<{ keyToId: Map<string, string>; idToKey: Map<string, string> }>(() => ({
    keyToId: new Map(), idToKey: new Map(),
  }));

  const refetchStages = useCallback(async () => {
    const { data: pipes } = await supabase.from("pipelines").select("*").order("created_at").limit(1);
    const pid = pipes?.[0]?.id ?? null;
    setPipelineId(pid);
    if (!pid) return;
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", pid)
      .order("order_index");
    const keyToId = new Map<string, string>();
    const idToKey = new Map<string, string>();
    const list: LeadStage[] = (data ?? []).map((r: any) => {
      keyToId.set(r.key, r.id);
      idToKey.set(r.id, r.key);
      return { id: r.key, title: r.title, color: r.color, icon: r.icon as LeadStage["icon"] };
    });
    setStageIdMap({ keyToId, idToKey });
    if (list.length) setStages(list);
  }, []);

  const refetchLeads = useCallback(async () => {
    if (stageIdMap.idToKey.size === 0) return;
    // Bounded fetches — don't drag the whole history of every table on each open.
    // Личные заявки полностью исключаем — они не должны попадать ни в одну выборку CRM.
    let leadsQuery = supabase
      .from("leads")
      .select("*")
      .eq("is_personal", false)
      .order("created_at", { ascending: false })
      .limit(500);
    if (projectId) {
      leadsQuery = leadsQuery.or(`project_id.eq.${projectId},project_id.is.null`);
    }
    const [leadsRes, commRes, evRes, tasksRes, histRes] = await Promise.all([
      leadsQuery,
      supabase
        .from("communications")
        .select("id,lead_id,type,direction,channel,content,status,template_key,is_draft,is_auto,created_by,created_at")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("events")
        .select("id,lead_id,event_type,payload,actor_id,created_at")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("tasks")
        .select("id,lead_id,title,due_at,status,done_at")
        .is("done_at", null)
        .limit(1000),
      supabase
        .from("lead_status_history")
        .select("id,lead_id,from_stage_id,to_stage_id,changed_at")
        .order("changed_at", { ascending: false })
        .limit(1000),
    ]);
    if (projectIdRef.current !== projectId) return;

    const events = (evRes.data ?? []) as EventRow[];
    const tasks = (tasksRes.data ?? []) as TaskRow[];
    const history = (histRes.data ?? []) as StageHistRow[];

    // Build per-lead indexes once: O(N + M) instead of O(N × M).
    const eventsByLead = new Map<string, EventRow[]>();
    for (const e of events) {
      if (!e.lead_id) continue;
      const arr = eventsByLead.get(e.lead_id);
      if (arr) arr.push(e);
      else eventsByLead.set(e.lead_id, [e]);
    }
    const tasksByLead = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      const arr = tasksByLead.get(t.lead_id);
      if (arr) arr.push(t);
      else tasksByLead.set(t.lead_id, [t]);
    }
    // History needs ascending order per lead for stage timeline.
    const historyByLead = new Map<string, StageHistRow[]>();
    for (const h of history) {
      const arr = historyByLead.get(h.lead_id);
      if (arr) arr.push(h);
      else historyByLead.set(h.lead_id, [h]);
    }
    for (const arr of historyByLead.values()) {
      arr.sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    }

    const visibleLeads = ((leadsRes.data ?? []) as LeadRow[]).map((r) =>
      leadRowToFrontIndexed(r, stageIdMap.idToKey, eventsByLead, tasksByLead, historyByLead),
    );
    setLeads(visibleLeads);
    // Communications were fetched DESC for limit; chats expect ASC for chronological render.
    // Чаты «личных» лидов тоже не показываем — фильтруем по id видимых лидов.
    const visibleIds = new Set(visibleLeads.map((l) => l.id));
    const commsAsc = ((commRes.data ?? []) as CommRow[])
      .slice()
      .reverse()
      .filter((c) => visibleIds.has(c.lead_id));
    setChats(commsAsc.map(commToChat));
  }, [stageIdMap.idToKey, projectId]);

  useEffect(() => { void refetchStages(); }, [refetchStages]);
  useEffect(() => { void refetchLeads(); }, [refetchLeads]);

  // Single debounced subscription per table — bursty webhook updates collapse
  // into one refetch.
  useRealtimeTable("pipeline_stages", refetchStages, true, 600);
  useRealtimeTable("leads", refetchLeads, true, 600);
  useRealtimeTable("communications", refetchLeads, true, 600);
  useRealtimeTable("tasks", refetchLeads, true, 600);
  useRealtimeTable("events", refetchLeads, true, 600);
  useRealtimeTable("lead_status_history", refetchLeads, true, 600);

  // capture utm on mount
  useEffect(() => { getLastTouch(); }, []);

  // ── Авто-движение лидов из leads_crm.auto_advance_stage (от n8n WA-анализа) ──
  // leads держим в ref, чтобы 30-секундный интервал не пересоздавался на каждом
  // обновлении массива — иначе таймер сбрасывался и фактически почти никогда не
  // срабатывал по расписанию.
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const pending = await fetchPendingAdvances();
        if (cancelled || pending.length === 0) return;
        for (const p of pending) {
          if (!p.phone || !p.auto_advance_stage) continue;
          const digits = String(p.phone).replace(/\D/g, "");
          const oldLead = leadsRef.current.find(
            (l) => String(l.phone).replace(/\D/g, "") === digits,
          );
          if (!oldLead) continue;
          if (oldLead.stageId === p.auto_advance_stage) {
            await markAdvanceDone(p.id);
            continue;
          }
          await moveLead(oldLead.id, p.auto_advance_stage);
          markAutoMoved(oldLead.id, p.auto_advance_stage);
          await markAdvanceDone(p.id);
        }
      } catch (e) {
        console.warn("[useCrmStore] auto-advance tick failed", e);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- helpers ----------
  const stageUuid = useCallback((key: string) => stageIdMap.keyToId.get(key), [stageIdMap]);

  // ---------- stages ----------
  const addStage = useCallback(async (title: string) => {
    if (!pipelineId) return;
    const key = `stage_${Date.now()}`;
    const order = stages.length;
    await supabase.from("pipeline_stages").insert({
      pipeline_id: pipelineId, key, title, color: "primary", icon: "zap", order_index: order,
    });
    await refetchStages();
  }, [pipelineId, stages.length, refetchStages]);

  const renameStage = useCallback(async (key: string, title: string) => {
    const id = stageUuid(key);
    if (!id) return;
    await supabase.from("pipeline_stages").update({ title }).eq("id", id);
  }, [stageUuid]);

  const removeStage = useCallback(async (key: string, fallbackKey?: string) => {
    if (stages.length <= 2) return;
    const id = stageUuid(key);
    const fallbackId = fallbackKey ? stageUuid(fallbackKey) : stageUuid("new");
    if (!id || !fallbackId) return;
    await supabase.from("leads").update({ stage_id: fallbackId }).eq("stage_id", id);
    await supabase.from("pipeline_stages").delete().eq("id", id);
  }, [stages.length, stageUuid]);

  const moveStage = useCallback(async (key: string, dir: -1 | 1) => {
    const idx = stages.findIndex((s) => s.id === key);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= stages.length) return;
    const a = stages[idx];
    const b = stages[target];
    const aId = stageUuid(a.id);
    const bId = stageUuid(b.id);
    if (!aId || !bId) return;
    await Promise.all([
      supabase.from("pipeline_stages").update({ order_index: target }).eq("id", aId),
      supabase.from("pipeline_stages").update({ order_index: idx }).eq("id", bId),
    ]);
  }, [stages, stageUuid]);

  // ---------- leads ----------
  /** Apply a patch to a single lead in local state immediately, without waiting for realtime. */
  const patchLeadLocal = useCallback((id: string, patcher: (l: Lead) => Lead) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? patcher(l) : l)));
  }, []);

  const addLead = useCallback(async (
    input: Omit<Lead, "id" | "createdAt" | "lastActivityAt">,
  ): Promise<Lead | undefined> => {
    if (!pipelineId) return;
    const stageId = stageUuid(input.stageId) ?? stageUuid("new");
    if (!stageId) return;
    const lt = getLastTouch();
    const { data, error } = await supabase.from("leads").insert({
      pipeline_id: pipelineId,
      stage_id: stageId,
      project_id: projectId || null,
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      source: input.source ?? lt?.utm?.source ?? "manual",
      channel: input.channel ?? null,
      amount: input.amount ?? 0,
      ai_score: input.aiScore ?? 50,
      note: input.note ?? null,
      service: input.service ?? null,
      city: input.city ?? null,
      age: input.age ?? null,
      utm: input.utm ?? lt?.utm ?? null,
      referrer: input.referrer ?? lt?.referrer ?? null,
      landing_url: input.landingUrl ?? lt?.landingUrl ?? null,
      first_touch_at: input.firstTouchAt ?? lt?.firstTouchAt ?? new Date().toISOString(),
      assigned_to: input.assigneeId ?? user?.id ?? null,
      created_by: user?.id ?? null,
    }).select().single();
    if (error || !data) return;
    // Optimistically prepend the new lead so it shows immediately.
    const row = data as LeadRow;
    const newLead: Lead = {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email ?? undefined,
      source: row.source,
      stageId: input.stageId,
      amount: Number(row.amount ?? 0),
      aiScore: row.ai_score ?? input.aiScore ?? 50,
      note: row.note ?? undefined,
      utm: (row.utm as UtmTags) ?? undefined,
      referrer: row.referrer ?? undefined,
      landingUrl: row.landing_url ?? undefined,
      firstTouchAt: row.first_touch_at ?? undefined,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      assigneeId: row.assigned_to ?? undefined,
      pinned: !!row.pinned,
      channel: (row.channel as Lead["channel"]) ?? undefined,
      cabinetId: row.cabinet_id ?? undefined,
      metaAdId: row.meta_ad_id ?? undefined,
      metaAdsetId: row.meta_adset_id ?? undefined,
      metaCampaignId: row.meta_campaign_id ?? undefined,
      isPersonal: row.is_personal ?? false,
      service: row.service ?? undefined,
      city: row.city ?? undefined,
      age: row.age ?? undefined,
      nextVisitAt: row.next_visit_at ?? undefined,
      paid: !!row.paid,
      paymentMethod: (row.payment_method as PaymentMethod) ?? undefined,
      paidAt: row.paid_at ?? undefined,
      tasks: [],
      events: [],
      stageHistory: [],
    };
    setLeads((prev) => (prev.some((l) => l.id === newLead.id) ? prev : [newLead, ...prev]));
    return newLead;
  }, [pipelineId, stageUuid, user?.id, projectId]);

  const updateLead = useCallback(async (id: string, patch: Partial<Lead>) => {
    const dbPatch: TablesUpdate<"leads"> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.email !== undefined) dbPatch.email = patch.email ?? null;
    if (patch.source !== undefined) dbPatch.source = patch.source;
    if (patch.amount !== undefined) dbPatch.amount = patch.amount;
    if (patch.diagnosticAmount !== undefined) (dbPatch as unknown as { diagnostic_amount?: number }).diagnostic_amount = patch.diagnosticAmount;
    if (patch.aiScore !== undefined) dbPatch.ai_score = patch.aiScore;
    if (patch.note !== undefined) dbPatch.note = patch.note ?? null;
    if (patch.service !== undefined) dbPatch.service = patch.service ?? null;
    if (patch.city !== undefined) dbPatch.city = patch.city ?? null;
    if (patch.age !== undefined) dbPatch.age = patch.age ?? null;
    if (patch.channel !== undefined) dbPatch.channel = patch.channel ?? null;
    if (patch.assigneeId !== undefined) dbPatch.assigned_to = patch.assigneeId ?? null;
    if (patch.pinned !== undefined) dbPatch.pinned = patch.pinned;
    if (patch.nextVisitAt !== undefined) dbPatch.next_visit_at = patch.nextVisitAt ?? null;
    if (patch.stageId !== undefined) {
      const sid = stageUuid(patch.stageId);
      if (sid) dbPatch.stage_id = sid;
    }
    if (Object.keys(dbPatch).length === 0) return;
    // Snapshot до patcha — чтобы откатить, если БД отказала.
    let prevSnapshot: Lead | undefined;
    setLeads((prev) => {
      prevSnapshot = prev.find((l) => l.id === id);
      return prev.map((l) => (l.id === id ? { ...l, ...patch, lastActivityAt: new Date().toISOString() } : l));
    });
    const { data, error } = await supabase
      .from("leads")
      .update(dbPatch)
      .eq("id", id)
      .select("id");
    if (error || !data || data.length === 0) {
      // RLS не пустил, либо колонки нет, либо id не найден — откатываем локально.
      if (prevSnapshot) {
        const snap = prevSnapshot;
        setLeads((prev) => prev.map((l) => (l.id === id ? snap : l)));
      }
      const reason = error?.message
        ?? "Supabase не вернул обновлённую строку (возможно, RLS блокирует UPDATE).";
      console.error("[useCrmStore.updateLead] failed:", reason, { id, dbPatch });
      toast.error(`Не удалось сохранить изменение: ${reason}`);
    }
  }, [stageUuid]);

  const removeLeads = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return { deleted: 0, failed: 0 };

    const idSet = new Set(uniqueIds);
    let prevSnapshot: Lead[] | undefined;
    setLeads((prev) => {
      prevSnapshot = prev;
      return prev.filter((l) => !idSet.has(l.id));
    });

    const { data, error } = await supabase.from("leads").delete().in("id", uniqueIds).select("id");
    if (error) {
      if (prevSnapshot) setLeads(prevSnapshot);
      console.error("[useCrmStore.removeLeads] failed:", error.message, { ids: uniqueIds });
      toast.error(`Не удалось удалить: ${error.message}`);
      return { deleted: 0, failed: uniqueIds.length };
    }

    const deleted = data?.length ?? 0;
    if (deleted === 0) {
      if (prevSnapshot) setLeads(prevSnapshot);
      console.error("[useCrmStore.removeLeads] RLS blocked delete (0 rows)", { ids: uniqueIds });
      toast.error("Не удалось удалить: нет прав или сделки уже удалены");
      return { deleted: 0, failed: uniqueIds.length };
    }

    if (deleted < uniqueIds.length) {
      const deletedIds = new Set((data ?? []).map((row) => row.id));
      const failedIds = uniqueIds.filter((id) => !deletedIds.has(id));
      if (prevSnapshot) {
        const restore = prevSnapshot.filter((l) => failedIds.includes(l.id));
        if (restore.length > 0) {
          setLeads((prev) => {
            const merged = [...prev];
            for (const lead of restore) {
              if (!merged.some((l) => l.id === lead.id)) merged.push(lead);
            }
            return merged;
          });
        }
      }
      toast.error(`Удалено ${deleted} из ${uniqueIds.length}. Остальные недоступны для удаления.`);
      return { deleted, failed: uniqueIds.length - deleted };
    }

    return { deleted, failed: 0 };
  }, []);

  const removeLead = useCallback(async (id: string) => {
    const result = await removeLeads([id]);
    return result.deleted > 0;
  }, [removeLeads]);

  /**
   * «Убрать в личные» — заявка не от клиента, а от личного контакта владельца.
   * Лид остаётся в БД (чтобы повторное сообщение с того же номера не создавало
   * нового лида), но проставляется is_personal=true и пропадает из всех выборок:
   * воронки, чатов, базы клиентов, аналитики, дашборда. Восстановление из UI
   * не предусмотрено — пользователь явно не хочет видеть раздел «Личные».
   */
  const markPersonal = useCallback(async (id: string) => {
    let prevLeads: Lead[] | undefined;
    let prevChats: ChatMessage[] | undefined;
    setLeads((prev) => { prevLeads = prev; return prev.filter((l) => l.id !== id); });
    setChats((prev) => { prevChats = prev; return prev.filter((c) => c.leadId !== id); });
    const { data, error } = await supabase
      .from("leads")
      .update({ is_personal: true })
      .eq("id", id)
      .select("id");
    if (error || !data || data.length === 0) {
      if (prevLeads) setLeads(prevLeads);
      if (prevChats) setChats(prevChats);
      const reason = error?.message
        ?? "Колонка is_personal ещё не применена в БД либо RLS блокирует UPDATE.";
      console.error("[useCrmStore.markPersonal] failed:", reason, { id });
      toast.error(`Не удалось убрать в личные: ${reason}`);
    }
  }, []);

  const moveLead = useCallback(async (leadId: string, stageKey: string) => {
    const sid = stageUuid(stageKey);
    if (!sid) return;
    patchLeadLocal(leadId, (l) => ({ ...l, stageId: stageKey, lastActivityAt: new Date().toISOString() }));
    await supabase.from("leads").update({ stage_id: sid }).eq("id", leadId);

    // Параллельно дёргаем CAPI на нового Supabase — он сам решит, слать ли Schedule/Purchase в Meta.
    try {
      const NEW_URL = (import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined) || "";
      const NEW_KEY = (import.meta.env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY as string | undefined) || "";
      if (!NEW_URL || !NEW_KEY) return;
      const lead = leads.find((l) => l.id === leadId);
      void fetch(`${NEW_URL}/functions/v1/crm-stage-capi`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${NEW_KEY}`,
          apikey: NEW_KEY,
        },
        body: JSON.stringify({
          lead_id: leadId,
          stage_key: stageKey,
          cabinet_id: lead?.cabinetId,
          event_value: lead?.amount && Number(lead.amount) > 0 ? Number(lead.amount) : undefined,
          event_source_url: lead?.landingUrl,
          user_data: {
            phone: lead?.phone,
            email: lead?.email,
            external_id: leadId,
            fbc: (lead?.utm as { fbc?: string } | undefined)?.fbc,
            fbp: (lead?.utm as { fbp?: string } | undefined)?.fbp,
          },
        }),
        keepalive: true,
      }).catch((err) => {
        console.warn("[useCrmStore.moveLead] CAPI sync failed (fire-and-forget)", err);
      });
    } catch (err) {
      console.warn("[useCrmStore.moveLead] CAPI sync threw", err);
    }
  }, [stageUuid, leads]);

  // ---------- chats ----------
  const sendMessage = useCallback(async (
    leadId: string,
    text: string,
    opts?: { templateKey?: string; channel?: ChatMessage["channel"] },
  ) => {
    const ch = opts?.channel;
    const allowedChannels = ["whatsapp", "telegram", "instagram", "phone", "email"] as const;
    type CommChannel = (typeof allowedChannels)[number];
    const safeChannel: CommChannel = (ch && (allowedChannels as readonly string[]).includes(ch))
      ? (ch as CommChannel) : "whatsapp";

    // For WhatsApp — send via Green API proxy. Webhook will mirror it back,
    // but to make UI snappy we also insert immediately.
    let deliveryStatus: "sent" | "failed" = "sent";
    let externalId: string | null = null;
    if (safeChannel === "whatsapp") {
      const lead = leads.find((l) => l.id === leadId);
      const phone = lead?.phone ?? "";
      try {
        const { data, error } = await supabase.functions.invoke("greenapi-proxy", {
          body: { action: "sendMessage", phone, message: text },
        });
        const idMessage = (data as { data?: { idMessage?: string } } | null)?.data?.idMessage ?? null;
        const ok =
          !error &&
          (data as { ok?: boolean } | null)?.ok !== false &&
          !!idMessage;
        if (!ok) deliveryStatus = "failed";
        externalId = idMessage;
      } catch {
        deliveryStatus = "failed";
      }
    }

    const insert: TablesInsert<"communications"> = {
      lead_id: leadId,
      type: "message",
      direction: "out",
      channel: safeChannel,
      content: text,
      status: deliveryStatus,
      template_key: opts?.templateKey ?? null,
      is_draft: false,
      is_auto: false,
      created_by: user?.id ?? null,
      external_id: externalId,
    };
    // Use upsert on external_id to avoid duplicate when the webhook arrives first
    if (externalId) {
      await supabase.from("communications").upsert(insert, { onConflict: "external_id", ignoreDuplicates: true });
    } else {
      await supabase.from("communications").insert(insert);
    }
  }, [user?.id, leads]);

  // ---------- growth ----------
  const togglePin = useCallback(async (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const next = !lead.pinned;
    patchLeadLocal(leadId, (l) => ({ ...l, pinned: next }));
    await supabase.from("leads").update({ pinned: next }).eq("id", leadId);
  }, [leads, patchLeadLocal]);

  const assignLead = useCallback(async (leadId: string, assigneeId?: string) => {
    patchLeadLocal(leadId, (l) => ({ ...l, assigneeId }));
    await supabase.from("leads").update({ assigned_to: assigneeId ?? null }).eq("id", leadId);
  }, [patchLeadLocal]);

  const setRejectReason = useCallback(async (
    leadId: string,
    reason: import("@/types/crm").RejectReason,
    note?: string,
  ) => {
    const trimmed = note?.trim();
    const lead = leads.find((l) => l.id === leadId);
    const newNote = trimmed
      ? [lead?.note, `Отказ: ${trimmed}`].filter(Boolean).join("\n")
      : lead?.note ?? null;
    const nowIso = new Date().toISOString();
    patchLeadLocal(leadId, (l) => ({
      ...l,
      rejectReason: reason,
      rejectedAt: nowIso,
      note: newNote ?? undefined,
    }));
    await supabase.from("leads").update({
      reject_reason: reason,
      rejected_at: nowIso,
      note: newNote,
    }).eq("id", leadId);
    await supabase.from("events").insert({
      lead_id: leadId,
      event_type: "rejected",
      payload: { reason, ...(trimmed ? { note: trimmed } : {}) },
      actor_id: user?.id ?? null,
    });
  }, [leads, user?.id, patchLeadLocal]);

  // ---------- card actions ----------
  const markCall = useCallback(async (
    leadId: string,
    opts?: { direction?: "outgoing" | "incoming"; status?: "answered" | "missed"; durationSec?: number; note?: string },
  ) => {
    const direction = opts?.direction ?? "outgoing";
    const callStatus = opts?.status ?? "answered";
    await supabase.from("communications").insert({
      lead_id: leadId,
      type: "call",
      direction: direction === "outgoing" ? "out" : "in",
      channel: "phone",
      content: opts?.note ?? null,
      status: callStatus === "missed" ? "missed" : "answered",
      is_draft: false,
      is_auto: false,
      created_by: user?.id ?? null,
    });
  }, [user?.id]);

  const markPaid = useCallback(async (
    leadId: string,
    method: PaymentMethod,
    amount?: number,
    opts?: { note?: string },
  ) => {
    const paidStageId = stageUuid("paid");
    const lead = leads.find((l) => l.id === leadId);
    const finalAmount = amount ?? lead?.amount ?? 0;
    const note = opts?.note?.trim();
    const nowIso = new Date().toISOString();
    const noteCombined = note ? [lead?.note, `Оплата: ${note}`].filter(Boolean).join("\n") : lead?.note;
    patchLeadLocal(leadId, (l) => ({
      ...l,
      paid: true,
      paymentMethod: method,
      paidAt: nowIso,
      amount: finalAmount,
      stageId: paidStageId ? "paid" : l.stageId,
      note: noteCombined,
      lastActivityAt: nowIso,
    }));
    await supabase.from("leads").update({
      paid: true,
      payment_method: method,
      paid_at: nowIso,
      amount: finalAmount,
      stage_id: paidStageId ?? lead?.stageId,
      note: noteCombined ?? null,
    }).eq("id", leadId);
    await supabase.from("deals").insert({
      lead_id: leadId,
      amount: finalAmount,
      status: "paid",
      payment_method: method,
      paid_at: new Date().toISOString(),
      created_by: user?.id ?? null,
    });
  }, [stageUuid, leads, user?.id]);

  const setVisit = useCallback(async (leadId: string, dateIso: string, moveToScheduled = true) => {
    const lead = leads.find((l) => l.id === leadId);
    const update: TablesUpdate<"leads"> = { next_visit_at: dateIso };
    let nextStageKey: string | undefined;
    if (moveToScheduled && lead && lead.stageId !== "scheduled" && lead.stageId !== "visit" && lead.stageId !== "paid") {
      const sid = stageUuid("scheduled");
      if (sid) { update.stage_id = sid; nextStageKey = "scheduled"; }
    }
    patchLeadLocal(leadId, (l) => ({
      ...l,
      nextVisitAt: dateIso,
      stageId: nextStageKey ?? l.stageId,
      lastActivityAt: new Date().toISOString(),
    }));
    await supabase.from("leads").update(update).eq("id", leadId);
    await supabase.from("events").insert({
      lead_id: leadId,
      event_type: "visit_scheduled",
      payload: { at: dateIso },
      actor_id: user?.id ?? null,
    });
  }, [leads, stageUuid, user?.id]);

  const addTask = useCallback(async (leadId: string, title: string, dueAt: string) => {
    const { data } = await supabase.from("tasks").insert({
      lead_id: leadId,
      title,
      due_at: dueAt,
      type: "followup",
      status: "pending",
      source: "manual",
      assigned_to: user?.id ?? null,
      created_by: user?.id ?? null,
    }).select("id").single();
    const newId = (data as { id?: string } | null)?.id;
    if (newId) {
      patchLeadLocal(leadId, (l) => ({
        ...l,
        tasks: [...(l.tasks ?? []), { id: newId, title, dueAt }],
      }));
    }
  }, [user?.id, patchLeadLocal]);

  const toggleTask = useCallback(async (leadId: string, taskId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    const task = lead?.tasks?.find((t) => t.id === taskId);
    if (!task) return;
    const nextDone = !task.doneAt;
    const nowIso = nextDone ? new Date().toISOString() : undefined;
    patchLeadLocal(leadId, (l) => ({
      ...l,
      tasks: (l.tasks ?? []).map((t) => (t.id === taskId ? { ...t, doneAt: nowIso } : t)),
    }));
    await supabase.from("tasks").update({
      status: nextDone ? "done" : "pending",
      done_at: nowIso ?? null,
    }).eq("id", taskId);
  }, [leads, patchLeadLocal]);

  const removeTask = useCallback(async (leadId: string, taskId: string) => {
    patchLeadLocal(leadId, (l) => ({
      ...l,
      tasks: (l.tasks ?? []).filter((t) => t.id !== taskId),
    }));
    await supabase.from("tasks").delete().eq("id", taskId);
  }, [patchLeadLocal]);

  const logCallAttempt = useCallback(async (leadId: string, info: {
    provider: string; ok: boolean; phone?: string; warning?: string; error?: string;
  }) => {
    await supabase.from("events").insert({
      lead_id: leadId,
      event_type: "call_attempt",
      payload: {
        provider: info.provider,
        ok: info.ok,
        ...(info.phone ? { phone: info.phone } : {}),
        ...(info.warning ? { warning: info.warning.slice(0, 160) } : {}),
        ...(info.error ? { error: info.error.slice(0, 160) } : {}),
      },
      actor_id: user?.id ?? null,
    });
  }, [user?.id]);

  return useMemo(() => ({
    stages,
    leads,
    chats,
    whatsapp,
    setWhatsapp: (cfg: WhatsAppConfig) => { void setWhatsapp(cfg); },
    addStage,
    renameStage,
    removeStage,
    moveStage,
    addLead,
    updateLead,
    removeLead,
    removeLeads,
    markPersonal,
    moveLead,
    sendMessage,
    togglePin,
    assignLead,
    setRejectReason,
    markCall,
    logCallAttempt,
    markPaid,
    setVisit,
    addTask,
    toggleTask,
    removeTask,
  }), [
    stages, leads, chats, whatsapp, setWhatsapp,
    addStage, renameStage, removeStage, moveStage,
    addLead, updateLead, removeLead, removeLeads, markPersonal, moveLead, sendMessage,
    togglePin, assignLead, setRejectReason,
    markCall, logCallAttempt, markPaid, setVisit,
    addTask, toggleTask, removeTask,
  ]);
}
