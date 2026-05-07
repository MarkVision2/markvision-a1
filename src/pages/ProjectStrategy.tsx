import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sparkles,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  ChevronRight,
  Edit3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useMarketingOs,
  type MarketingOsCommand,
  type MarketingOsStatus,
} from "@/hooks/useMarketingOsArtifacts";
import {
  BriefForm,
  briefToInvokeBody,
  useBriefFormState,
} from "@/components/strategy/BriefForm";

interface StepDef {
  key: "onboarding" | MarketingOsCommand;
  label: string;
  description: string;
  fnName:
    | "generate-project-brief"
    | "marketing-os-creatives"
    | "marketing-os-content"
    | "marketing-os-site-brief"
    | "marketing-os-site-build";
  needs: ("onboarding" | MarketingOsCommand)[];
}

const STEPS: StepDef[] = [
  {
    key: "onboarding",
    label: "Онбординг",
    description: "Сегменты, индекс 0-100, продуктовая матрица, сценарии запуска.",
    fnName: "generate-project-brief",
    needs: [],
  },
  {
    key: "creatives",
    label: "Креативы",
    description: "9 крео на сегмент: 3 формата × 3 угла, готовые промты для Gemini.",
    fnName: "marketing-os-creatives",
    needs: ["onboarding"],
  },
  {
    key: "content",
    label: "Контент",
    description: "Лид-магнит + 5 рилсов на выдачу + 10 рилсов + 8 постов + календарь.",
    fnName: "marketing-os-content",
    needs: ["onboarding"],
  },
  {
    key: "site_brief",
    label: "ТЗ сайта",
    description: "Блоки сайта BL1..BL10 с готовыми текстами и SEO-метой.",
    fnName: "marketing-os-site-brief",
    needs: ["onboarding"],
  },
  {
    key: "site_build",
    label: "Сборка сайта",
    description: "Single-file HTML с Tailwind, готов к деплою.",
    fnName: "marketing-os-site-build",
    needs: ["site_brief"],
  },
];

type StatusMap = Record<string, { status: MarketingOsStatus | "missing"; markdown: string | null; payload: unknown; error: string | null }>;

function statusBadge(status: MarketingOsStatus | "missing") {
  switch (status) {
    case "done":
      return <Badge variant="outline" className="border-success/40 bg-success/10 text-success"><CheckCircle2 className="mr-1 h-3 w-3" />готово</Badge>;
    case "running":
      return <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning"><Loader2 className="mr-1 h-3 w-3 animate-spin" />генерируется</Badge>;
    case "error":
      return <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive"><AlertTriangle className="mr-1 h-3 w-3" />ошибка</Badge>;
    case "pending":
      return <Badge variant="outline">в очереди</Badge>;
    default:
      return <Badge variant="secondary">не запущено</Badge>;
  }
}

export default function ProjectStrategy() {
  const { id: projectId } = useParams<{ id: string }>();
  const { brief, artifacts, loading, runCommand } = useMarketingOs(projectId ?? null);
  const [activeKey, setActiveKey] = useState<StepDef["key"]>("onboarding");
  const [patches, setPatches] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [briefForm, setBriefForm] = useBriefFormState(brief as unknown as Record<string, unknown> | null);
  const [editingBrief, setEditingBrief] = useState(false);

  const statusMap: StatusMap = useMemo(() => {
    const map: StatusMap = {
      onboarding: brief?.brief_md
        ? { status: "done", markdown: brief.brief_md, payload: null, error: null }
        : { status: "missing", markdown: null, payload: null, error: null },
    };
    (Object.keys(artifacts) as MarketingOsCommand[]).forEach((k) => {
      const a = artifacts[k];
      map[k] = a
        ? { status: a.status, markdown: a.markdown, payload: a.payload, error: a.error }
        : { status: "missing", markdown: null, payload: null, error: null };
    });
    return map;
  }, [brief, artifacts]);

  const activeStep = STEPS.find((s) => s.key === activeKey)!;
  const activeState = statusMap[activeKey];

  const blockedReason = useMemo(() => {
    for (const need of activeStep.needs) {
      const s = statusMap[need]?.status;
      if (s !== "done") return `Сначала запустите шаг «${STEPS.find((x) => x.key === need)?.label}».`;
    }
    return null;
  }, [activeStep, statusMap]);

  const runOnboarding = async () => {
    if (!projectId) return;
    if (!briefForm.niche.trim() && !briefForm.product.trim() && !briefForm.audience.trim()) {
      toast.error("Заполните хотя бы нишу, продукт или ЦА");
      return;
    }
    setRunning((p) => ({ ...p, onboarding: true }));
    try {
      await runCommand("generate-project-brief", briefToInvokeBody(briefForm));
      setEditingBrief(false);
      toast.success("Стратегия пересобрана");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Онбординг: ${msg}`);
    } finally {
      setRunning((p) => ({ ...p, onboarding: false }));
    }
  };

  const onRun = async (step: StepDef) => {
    if (!projectId) return;
    if (step.key === "onboarding") {
      await runOnboarding();
      return;
    }
    setRunning((p) => ({ ...p, [step.key]: true }));
    try {
      const patch = patches[step.key]?.trim();
      const extra = patch ? { patchInstruction: patch } : undefined;
      await runCommand(step.fnName, extra);
      toast.success(`${step.label}: запущено`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`${step.label}: ${msg}`);
    } finally {
      setRunning((p) => ({ ...p, [step.key]: false }));
    }
  };

  const downloadHtml = () => {
    const html = (artifacts.site_build?.payload as { html?: string } | null)?.html;
    if (!html) return;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "marketing-os-site.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const onboardingDone = !!brief?.brief_md;
  const siteHtml = (artifacts.site_build?.payload as { html?: string } | null)?.html;
  const showBriefEditor = activeKey === "onboarding" && (editingBrief || !onboardingDone);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Левая колонка — список шагов */}
      <div className="col-span-12 md:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-success" /> Marketing OS
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {STEPS.map((s) => {
              const st = statusMap[s.key].status;
              const active = s.key === activeKey;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveKey(s.key)}
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left transition-colors",
                    active ? "border-success bg-success/10" : "border-border/60 hover:bg-secondary/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{s.label}</div>
                    {statusBadge(st)}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {s.description}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Правая колонка — содержимое активного шага */}
      <div className="col-span-12 md:col-span-9 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <ChevronRight className="h-4 w-4" /> {activeStep.label}
              </span>
              <div className="flex items-center gap-2">
                {activeKey === "onboarding" && onboardingDone && !editingBrief && (
                  <Button variant="outline" size="sm" onClick={() => setEditingBrief(true)}>
                    <Edit3 className="mr-1 h-4 w-4" /> Редактировать бриф
                  </Button>
                )}
                {activeKey === "site_build" && siteHtml && (
                  <Button variant="outline" size="sm" onClick={downloadHtml}>
                    <Download className="mr-1 h-4 w-4" /> Скачать HTML
                  </Button>
                )}
                {!showBriefEditor && (
                  <Button
                    size="sm"
                    onClick={() => onRun(activeStep)}
                    disabled={!!blockedReason || running[activeKey]}
                  >
                    {running[activeKey] ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-4 w-4" />
                    )}
                    {activeState.status === "done" ? "Перегенерировать" : "Сгенерировать"}
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{activeStep.description}</p>
            {blockedReason && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                {blockedReason}
              </div>
            )}
            {activeState.status === "error" && activeState.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {activeState.error}
              </div>
            )}

            {/* Onboarding: форма брифа (на пустом проекте или при редактировании) */}
            {showBriefEditor && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Бриф проекта</div>
                  {onboardingDone && (
                    <Button variant="ghost" size="sm" onClick={() => setEditingBrief(false)}>
                      Отменить
                    </Button>
                  )}
                </div>
                <BriefForm
                  value={briefForm}
                  onChange={setBriefForm}
                  onSubmit={runOnboarding}
                  busy={running.onboarding}
                  submitLabel={onboardingDone ? "Пересобрать стратегию" : "Запустить онбординг"}
                />
              </div>
            )}

            {/* Patch instruction (для всех команд кроме онбординга) */}
            {activeKey !== "onboarding" && !blockedReason && (
              <div className="space-y-1.5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Правка по кодам (опционально)
                </div>
                <Textarea
                  rows={2}
                  placeholder="Например: «переделай V2 — добавь больше эмоций» или «замени рилс CR3»"
                  value={patches[activeKey] ?? ""}
                  onChange={(e) => setPatches((p) => ({ ...p, [activeKey]: e.target.value }))}
                />
              </div>
            )}

            {/* Site build preview */}
            {activeKey === "site_build" && siteHtml && (
              <div className="overflow-hidden rounded-lg border border-border/60">
                <iframe
                  title="site-preview"
                  srcDoc={siteHtml}
                  className="h-[640px] w-full bg-white"
                  sandbox="allow-same-origin"
                />
              </div>
            )}

            {/* Markdown */}
            {!showBriefEditor && (
              activeState.markdown ? (
                <article className="prose prose-sm prose-invert max-w-none rounded-lg border border-border/60 bg-card/40 p-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {activeState.markdown}
                  </ReactMarkdown>
                </article>
              ) : !blockedReason ? (
                <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Документ ещё не сгенерирован. Нажмите «Сгенерировать» вверху.
                </div>
              ) : null
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
