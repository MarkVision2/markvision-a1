import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CalendarClock, ClipboardList, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContentPlanKpis } from "@/components/content-plan/ContentPlanKpis";
import { ContentPlanTable } from "@/components/content-plan/ContentPlanTable";
import { ContentPlanComposerDialog } from "@/components/content-plan/ContentPlanComposerDialog";
import { useContentPlan } from "@/hooks/useContentPlan";
import type { ContentPlanItem } from "@/lib/contentPlan";
import { AutoPost } from "@/pages/AutoPost";

export default function ContentPlan() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "autopost" ? "autopost" : "plan";
  const { items, summary, loading, error, tableMissing, refetch, create, update, adoptSynthetic } =
    useContentPlan();
  const [composerOpen, setComposerOpen] = useState(false);

  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === "plan") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  };

  const sorted = useMemo(() => items, [items]);

  const onTogglePlatform = async (
    id: string,
    key: keyof ContentPlanItem["platforms"],
    value: boolean,
  ) => {
    try {
      await update(id, { platforms: { [key]: value } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  const onAdopt = async (item: ContentPlanItem) => {
    try {
      const id = await adoptSynthetic(item);
      toast.success("Добавлено в контент-план");
      window.location.assign(`/marketing/content-plan/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить");
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        icon={ClipboardList}
        iconAccent="pink"
        title="Контент-план"
        description="Идея → публикация → код-слово → лид → оплата. Автопостинг вшит в этот раздел."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => void refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Обновить
            </Button>
            <Button size="sm" className="gap-1" onClick={() => setComposerOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Новая публикация
            </Button>
          </div>
        }
      />

      {tableMissing && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Таблица <code className="font-mono text-xs">content_plan_items</code> ещё не применена.
            Выполните миграцию{" "}
            <code className="font-mono text-xs">20260719150000_content_plan_items.sql</code> в
            Supabase SQL Editor. Пока показываем синтетические строки из Instagram и код-слов.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-6">
        <ContentPlanKpis summary={summary} />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="plan" className="gap-1">
            <ClipboardList className="h-3.5 w-3.5" />
            План
          </TabsTrigger>
          <TabsTrigger value="autopost" className="gap-1">
            <CalendarClock className="h-3.5 w-3.5" />
            Автопостинг
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Каждая строка = одна публикация. Клик по названию открывает карточку с воронкой.
            </span>
            <Link to="/marketing/content-center" className="text-primary hover:underline">
              Контент-центр →
            </Link>
          </div>
          <ContentPlanTable
            items={sorted}
            loading={loading}
            onTogglePlatform={onTogglePlatform}
            onAdopt={onAdopt}
          />
        </TabsContent>

        <TabsContent value="autopost" className="mt-4">
          <AutoPost embedded />
        </TabsContent>
      </Tabs>

      <ContentPlanComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onCreate={create}
      />
    </PageContainer>
  );
}
