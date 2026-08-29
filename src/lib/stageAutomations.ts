import { supabase } from "@/integrations/supabase/client";
import type { Lead, LeadStage } from "@/types/crm";

export type StageAutomationRule = {
  id: string;
  stageId: string;
  enabled: boolean;
  title: string;
  template: string;
};

export const STAGE_AUTOMATION_VARIABLES = [
  "{name}",
  "{phone}",
  "{stage}",
  "{manager}",
  "{visit_datetime}",
  "{source}",
] as const;

const RULES_PREFIX = "crm.stage-automations.v1";
const SENT_PREFIX = "crm.stage-automation-sent.v1";

export type ProjectAutomationSettings = {
  followup_2h_enabled: boolean;
  followup_2h_minutes: number;
  auto_msg_24h_enabled: boolean;
  auto_msg_24h_hours: number;
  auto_msg_24h_template_key: string;
  revival_7d_enabled: boolean;
  revival_7d_days: number;
  revival_7d_template_key: string;
};

// Без `as const`: это значения по умолчанию, а не допустимые значения. С `as const`
// тип сужался до литералов (true / 120 / "followup_24h"), и форма настроек не могла
// записать в них ничего другого.
const DEFAULT_PROJECT_SETTINGS: ProjectAutomationSettings = {
  followup_2h_enabled: true,
  followup_2h_minutes: 120,
  auto_msg_24h_enabled: true,
  auto_msg_24h_hours: 24,
  auto_msg_24h_template_key: "followup_24h",
  revival_7d_enabled: true,
  revival_7d_days: 7,
  revival_7d_template_key: "revival_7d",
};

function storageProjectKey(prefix: string, projectId?: string | null) {
  return `${prefix}:${projectId || "global"}`;
}

function normalizeText(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function isNoAnswerStage(stage: LeadStage) {
  const id = normalizeText(stage.id);
  const title = normalizeText(stage.title);
  return id === "no_answer" || title.includes("без ответа") || title.includes("не отвечает");
}

function isDiagnosticStage(stage: LeadStage) {
  const id = normalizeText(stage.id);
  const title = normalizeText(stage.title);
  return (
    stage.stageRole === "call_scheduled"
    || stage.isDiagnostic === true
    || id === "scheduled"
    || id === "diagnostic"
    || title.includes("диагност")
    || title.includes("запис")
  );
}

function ruleKind(stage: LeadStage): "new" | "no_answer" | "diagnostic" | "custom" {
  if (stage.stageRole === "new" || stage.id === "new") return "new";
  if (isNoAnswerStage(stage)) return "no_answer";
  if (isDiagnosticStage(stage)) return "diagnostic";
  return "custom";
}

function templateFor(stage: LeadStage) {
  const kind = ruleKind(stage);
  if (kind === "new") {
    return "Добрый день, {name}! Спасибо за заявку в бухгалтерскую компанию Адал есеп.\nМеня зовут {manager}. Подскажите, вам удобнее продолжить в переписке или могу позвонить?";
  }
  if (kind === "no_answer") {
    return "{name}, добрый день. Мне не удалось с вами связаться. Подскажите, когда вам удобно продолжить или лучше написать здесь?";
  }
  if (kind === "diagnostic") {
    return "{name}, вы записаны на диагностику и разбор на {visit_datetime}.\nПодготовьте, пожалуйста: ИП/ТОО, текущие вопросы по налогам, документы или выписки, которые хотите разобрать.\nЕсли что-то не получится, напишите заранее.";
  }
  return "{name}, добрый день. По вашей заявке обновился этап: {stage}.";
}

export function defaultStageAutomationRules(stages: LeadStage[]): StageAutomationRule[] {
  const preferred = stages.filter((stage) => ruleKind(stage) !== "custom");
  return preferred.map((stage) => ({
    id: `stage:${stage.id}`,
    stageId: stage.id,
    enabled: true,
    title: `Когда лид попал в «${stage.title}»`,
    template: templateFor(stage),
  }));
}

function loadStageAutomationRulesFromLocalStorage(
  projectId: string | null | undefined,
  stages: LeadStage[],
): StageAutomationRule[] {
  if (typeof window === "undefined") return defaultStageAutomationRules(stages);
  const key = storageProjectKey(RULES_PREFIX, projectId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaultStageAutomationRules(stages);
    const parsed = JSON.parse(raw) as StageAutomationRule[];
    if (!Array.isArray(parsed)) return defaultStageAutomationRules(stages);
    const stageIds = new Set(stages.map((stage) => stage.id));
    return parsed.filter((rule) => stageIds.has(rule.stageId));
  } catch {
    return defaultStageAutomationRules(stages);
  }
}

/** @deprecated Prefer fetchStageAutomationRulesFromDb */
export function loadStageAutomationRules(
  projectId: string | null | undefined,
  stages: LeadStage[],
): StageAutomationRule[] {
  return loadStageAutomationRulesFromLocalStorage(projectId, stages);
}

export function leadBelongsToProject(lead: { projectId?: string | null }, projectId: string | null | undefined): boolean {
  if (!projectId || !lead.projectId) return false;
  return lead.projectId === projectId;
}

export async function fetchStageAutomationRulesFromDb(
  projectId: string | null | undefined,
  stages: LeadStage[],
): Promise<StageAutomationRule[]> {
  if (!projectId) return defaultStageAutomationRules(stages);
  const stageIds = new Set(stages.map((s) => s.id));

  const { data, error } = await supabase
    .from("project_stage_automation_rules")
    .select("id, stage_id, enabled, title, template")
    .eq("project_id", projectId);

  if (error) throw new Error(error.message);

  if (!data?.length) {
    const fromLocal = loadStageAutomationRulesFromLocalStorage(projectId, stages);
    // Не переносим «global» bucket — только правила, явно сохранённые для этого projectId.
    const hasProjectKey = typeof window !== "undefined"
      && window.localStorage.getItem(storageProjectKey(RULES_PREFIX, projectId)) != null;
    if (fromLocal.length > 0 && hasProjectKey) {
      await saveStageAutomationRulesToDb(projectId, fromLocal);
    }
    return hasProjectKey ? fromLocal : defaultStageAutomationRules(stages);
  }

  return data
    .filter((row) => stageIds.has(row.stage_id))
    .map((row) => ({
      id: row.id,
      stageId: row.stage_id,
      enabled: row.enabled,
      title: row.title,
      template: row.template,
    }));
}

/** @deprecated Prefer saveStageAutomationRulesToDb */
export function saveStageAutomationRules(projectId: string | null | undefined, rules: StageAutomationRule[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageProjectKey(RULES_PREFIX, projectId), JSON.stringify(rules));
}

export async function saveStageAutomationRulesToDb(
  projectId: string,
  rules: StageAutomationRule[],
): Promise<void> {
  const rows = rules.map((rule) => ({
    project_id: projectId,
    stage_id: rule.stageId,
    enabled: rule.enabled,
    title: rule.title,
    template: rule.template,
  }));

  const { error: delErr } = await supabase
    .from("project_stage_automation_rules")
    .delete()
    .eq("project_id", projectId);
  if (delErr) throw new Error(delErr.message);

  if (rows.length === 0) return;

  const { error: insErr } = await supabase
    .from("project_stage_automation_rules")
    .insert(rows);
  if (insErr) throw new Error(insErr.message);

  saveStageAutomationRules(projectId, rules);
}

export async function fetchProjectAutomationSettings(
  projectId: string,
): Promise<ProjectAutomationSettings> {
  const { data, error } = await supabase
    .from("project_automation_settings")
    .select(
      "followup_2h_enabled, followup_2h_minutes, auto_msg_24h_enabled, auto_msg_24h_hours, auto_msg_24h_template_key, revival_7d_enabled, revival_7d_days, revival_7d_template_key",
    )
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return data as ProjectAutomationSettings;

  const { error: insErr } = await supabase
    .from("project_automation_settings")
    .insert({ project_id: projectId, ...DEFAULT_PROJECT_SETTINGS });
  if (insErr) throw new Error(insErr.message);
  return { ...DEFAULT_PROJECT_SETTINGS };
}

export async function saveProjectAutomationSettings(
  projectId: string,
  settings: ProjectAutomationSettings,
): Promise<void> {
  const { error } = await supabase
    .from("project_automation_settings")
    .upsert({ project_id: projectId, ...settings, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export function findStageAutomationRule(rules: StageAutomationRule[], stageId: string) {
  return rules.find((rule) => rule.stageId === stageId && rule.enabled && rule.template.trim());
}

export function renderStageAutomationTemplate(
  template: string,
  input: {
    lead: Lead;
    stage?: LeadStage | null;
    managerName?: string | null;
    visitAt?: string | null;
  },
) {
  const visit = input.visitAt || input.lead.nextVisitAt;
  const values: Record<string, string> = {
    name: input.lead.name || "клиент",
    phone: input.lead.phone || "",
    stage: input.stage?.title || input.lead.stageId,
    manager: input.managerName || "менеджер",
    visit_datetime: visit
      ? new Date(visit).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "согласованное время",
    source: input.lead.source || "заявка",
  };

  return template.replace(/\{(name|phone|stage|manager|visit_datetime|source)\}/g, (_, key: string) => values[key] ?? "");
}

export async function wasStageAutomationSent(
  projectId: string | null | undefined,
  leadId: string,
  _ruleId: string,
  stageId: string,
): Promise<boolean> {
  if (!projectId) return false;

  const { data, error } = await supabase
    .from("project_stage_automation_sent")
    .select("lead_id")
    .eq("project_id", projectId)
    .eq("lead_id", leadId)
    .eq("stage_id", stageId)
    .maybeSingle();

  if (!error && data) return true;

  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(storageProjectKey(SENT_PREFIX, projectId));
  const sent = raw ? JSON.parse(raw) as Record<string, boolean> : {};
  return Boolean(sent[`${leadId}:${_ruleId}:${stageId}`]);
}

export async function markStageAutomationSent(
  projectId: string | null | undefined,
  leadId: string,
  ruleId: string,
  stageId: string,
): Promise<void> {
  if (!projectId) return;

  await supabase
    .from("project_stage_automation_sent")
    .upsert({ project_id: projectId, lead_id: leadId, stage_id: stageId });

  if (typeof window === "undefined") return;
  const key = storageProjectKey(SENT_PREFIX, projectId);
  const raw = window.localStorage.getItem(key);
  const sent = raw ? JSON.parse(raw) as Record<string, boolean> : {};
  sent[`${leadId}:${ruleId}:${stageId}`] = true;
  window.localStorage.setItem(key, JSON.stringify(sent));
}
