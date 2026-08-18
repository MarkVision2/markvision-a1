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

export function loadStageAutomationRules(
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

export function saveStageAutomationRules(projectId: string | null | undefined, rules: StageAutomationRule[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageProjectKey(RULES_PREFIX, projectId), JSON.stringify(rules));
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

export function wasStageAutomationSent(
  projectId: string | null | undefined,
  leadId: string,
  ruleId: string,
  stageId: string,
) {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(storageProjectKey(SENT_PREFIX, projectId));
  const sent = raw ? JSON.parse(raw) as Record<string, boolean> : {};
  return Boolean(sent[`${leadId}:${ruleId}:${stageId}`]);
}

export function markStageAutomationSent(
  projectId: string | null | undefined,
  leadId: string,
  ruleId: string,
  stageId: string,
) {
  if (typeof window === "undefined") return;
  const key = storageProjectKey(SENT_PREFIX, projectId);
  const raw = window.localStorage.getItem(key);
  const sent = raw ? JSON.parse(raw) as Record<string, boolean> : {};
  sent[`${leadId}:${ruleId}:${stageId}`] = true;
  window.localStorage.setItem(key, JSON.stringify(sent));
}
