import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate, TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
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
    service: r.service ?? undefined,
    city: r.city ?? undefined,
    age: r.age ?? undefined,
    nextVisitAt: r.next_visit_at ?? undefined,
    paid: r.paid,
    paymentMethod: (r.payment_method as PaymentMethod) ?? undefined,
    paidAt: r.paid_at ?? undefined,
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

  const [stages, setStages] = useState<LeadStage[]>(DEFAULT_STAGES);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);

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
    const [leadsRes, commRes, evRes, tasksRes, histRes] = await Promise.all([
      supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
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

    setLeads(((leadsRes.data ?? []) as LeadRow[]).map((r) =>
      leadRowToFrontIndexed(r, stageIdMap.idToKey, eventsByLead, tasksByLead, historyByLead),
    ));
    // Communications were fetched DESC for limit; chats expect ASC for chronological render.
    const commsAsc = ((commRes.data ?? []) as CommRow[]).slice().reverse();
    setChats(commsAsc.map(commToChat));
  }, [stageIdMap.idToKey]);

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
    await refetchLeads();
    return undefined;
  }, [pipelineId, stageUuid, user?.id, refetchLeads]);

  const updateLead = useCallback(async (id: string, patch: Partial<Lead>) => {
    const dbPatch: TablesUpdate<"leads"> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.email !== undefined) dbPatch.email = patch.email ?? null;
    if (patch.source !== undefined) dbPatch.source = patch.source;
    if (patch.amount !== undefined) dbPatch.amount = patch.amount;
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
    await supabase.from("leads").update(dbPatch).eq("id", id);
  }, [stageUuid]);

  const removeLead = useCallback(async (id: string) => {
    await supabase.from("leads").delete().eq("id", id);
  }, []);

  const moveLead = useCallback(async (leadId: string, stageKey: string) => {
    const sid = stageUuid(stageKey);
    if (!sid) return;
    await supabase.from("leads").update({ stage_id: sid }).eq("id", leadId);
  }, [stageUuid]);

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
    await supabase.from("leads").update({ pinned: !lead.pinned }).eq("id", leadId);
  }, [leads]);

  const assignLead = useCallback(async (leadId: string, assigneeId?: string) => {
    await supabase.from("leads").update({ assigned_to: assigneeId ?? null }).eq("id", leadId);
  }, []);

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
    await supabase.from("leads").update({
      reject_reason: reason,
      rejected_at: new Date().toISOString(),
      note: newNote,
    }).eq("id", leadId);
    await supabase.from("events").insert({
      lead_id: leadId,
      event_type: "rejected",
      payload: { reason, ...(trimmed ? { note: trimmed } : {}) },
      actor_id: user?.id ?? null,
    });
  }, [leads, user?.id]);

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
    await supabase.from("leads").update({
      paid: true,
      payment_method: method,
      paid_at: new Date().toISOString(),
      amount: finalAmount,
      stage_id: paidStageId ?? lead?.stageId,
      note: note ? [lead?.note, `Оплата: ${note}`].filter(Boolean).join("\n") : lead?.note ?? null,
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
    if (moveToScheduled && lead && lead.stageId !== "scheduled" && lead.stageId !== "visit" && lead.stageId !== "paid") {
      const sid = stageUuid("scheduled");
      if (sid) update.stage_id = sid;
    }
    await supabase.from("leads").update(update).eq("id", leadId);
    await supabase.from("events").insert({
      lead_id: leadId,
      event_type: "visit_scheduled",
      payload: { at: dateIso },
      actor_id: user?.id ?? null,
    });
  }, [leads, stageUuid, user?.id]);

  const addTask = useCallback(async (leadId: string, title: string, dueAt: string) => {
    await supabase.from("tasks").insert({
      lead_id: leadId,
      title,
      due_at: dueAt,
      type: "followup",
      status: "pending",
      source: "manual",
      assigned_to: user?.id ?? null,
      created_by: user?.id ?? null,
    });
  }, [user?.id]);

  const toggleTask = useCallback(async (leadId: string, taskId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    const task = lead?.tasks?.find((t) => t.id === taskId);
    if (!task) return;
    const nextDone = !task.doneAt;
    await supabase.from("tasks").update({
      status: nextDone ? "done" : "pending",
      done_at: nextDone ? new Date().toISOString() : null,
    }).eq("id", taskId);
  }, [leads]);

  const removeTask = useCallback(async (leadId: string, taskId: string) => {
    await supabase.from("tasks").delete().eq("id", taskId);
  }, []);

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
    addLead, updateLead, removeLead, moveLead, sendMessage,
    togglePin, assignLead, setRejectReason,
    markCall, logCallAttempt, markPaid, setVisit,
    addTask, toggleTask, removeTask,
  ]);
}
