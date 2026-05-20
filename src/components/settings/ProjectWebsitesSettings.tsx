import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2, Plus, Star, StarOff, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";

interface ProjectWebsite {
  id: string;
  ad_account_id: string;
  url: string;
  label: string | null;
  is_default: boolean;
  created_at: string;
}

const normalizeUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

export function ProjectWebsitesSettings() {
  const { cabinets } = useCabinetsStore();
  const cabinetsWithAcc = useMemo(
    () => cabinets.filter((c) => !!c.adAccountId),
    [cabinets],
  );

  // userSelectedAcc — явный выбор пользователя; пока пусто, берём первый кабинет с adAccountId.
  // Derived state вместо useEffect — экономим один ре-рендер при загрузке списка.
  const [userSelectedAcc, setUserSelectedAcc] = useState<string>("");
  const selectedAcc = userSelectedAcc || cabinetsWithAcc[0]?.adAccountId || "";

  const [websites, setWebsites] = useState<ProjectWebsite[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ProjectWebsite | null>(null);

  const fetchWebsites = useCallback(async () => {
    if (!clientConfigSupabase || !selectedAcc) {
      setWebsites([]);
      return;
    }
    setLoading(true);
    const { data, error } = await clientConfigSupabase
      .from("project_websites")
      .select("id, ad_account_id, url, label, is_default, created_at")
      .eq("ad_account_id", selectedAcc)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("Не удалось загрузить сайты", { description: error.message });
      return;
    }
    setWebsites((data ?? []) as ProjectWebsite[]);
  }, [selectedAcc]);

  useEffect(() => {
    void fetchWebsites();
  }, [fetchWebsites]);

  const handleAdd = useCallback(async () => {
    if (!clientConfigSupabase) {
      toast.error("Client config DB не настроен");
      return;
    }
    if (!selectedAcc) {
      toast.error("Сначала выберите кабинет");
      return;
    }
    const url = normalizeUrl(newUrl);
    if (!hostOf(url)) {
      toast.error("Неверный URL", { description: "Пример: https://example.com" });
      return;
    }
    // Дубликат по хосту?
    const dupe = websites.find((w) => hostOf(w.url) === hostOf(url));
    if (dupe) {
      toast.error("Такой домен уже привязан", {
        description: dupe.url,
      });
      return;
    }
    setSaving(true);
    const isFirst = websites.length === 0;
    const { error } = await clientConfigSupabase.from("project_websites").insert({
      ad_account_id: selectedAcc,
      url,
      label: newLabel.trim() || null,
      is_default: isFirst, // первый сайт автоматически дефолт
    });
    setSaving(false);
    if (error) {
      toast.error("Не удалось добавить сайт", { description: error.message });
      return;
    }
    toast.success("Сайт привязан к кабинету");
    setNewUrl("");
    setNewLabel("");
    void fetchWebsites();
  }, [newUrl, newLabel, selectedAcc, websites, fetchWebsites]);

  const handleMakeDefault = useCallback(
    async (site: ProjectWebsite) => {
      if (!clientConfigSupabase) return;
      if (site.is_default) return;
      setSaving(true);
      // Сначала снять флаг у других, потом поставить новому — иначе сработает unique index
      const { error: clearErr } = await clientConfigSupabase
        .from("project_websites")
        .update({ is_default: false })
        .eq("ad_account_id", site.ad_account_id);
      if (clearErr) {
        setSaving(false);
        toast.error("Не удалось обновить дефолт", { description: clearErr.message });
        return;
      }
      const { error } = await clientConfigSupabase
        .from("project_websites")
        .update({ is_default: true })
        .eq("id", site.id);
      setSaving(false);
      if (error) {
        toast.error("Не удалось обновить дефолт", { description: error.message });
        return;
      }
      toast.success("Сайт по умолчанию обновлён");
      void fetchWebsites();
    },
    [fetchWebsites],
  );

  const handleDelete = useCallback(async () => {
    if (!clientConfigSupabase || !pendingDelete) return;
    setSaving(true);
    const { error } = await clientConfigSupabase
      .from("project_websites")
      .delete()
      .eq("id", pendingDelete.id);
    setSaving(false);
    if (error) {
      toast.error("Не удалось удалить", { description: error.message });
      return;
    }
    toast.success("Сайт удалён из whitelist");
    setPendingDelete(null);
    void fetchWebsites();
  }, [pendingDelete, fetchWebsites]);

  if (cabinetsWithAcc.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-4 w-4" /> Домены проекта
          </CardTitle>
          <CardDescription>
            Чтобы привязывать сайты — сначала добавьте рекламный кабинет с
            заполненным <code>Ad Account ID</code> на странице{" "}
            <a className="underline" href="/ads">Кабинеты</a>.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-4 w-4" /> Домены проекта (whitelist)
          </CardTitle>
          <CardDescription>
            Сайты, на которые AI-таргетолог может запускать рекламу. Один
            пиксель — много сайтов: достаточно прислать в Telegram-бот ссылку
            на любой из привязанных доменов (или путь под ним), и кампания
            улетит на этот URL с проектным пикселем.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-md">
            <Label>Кабинет</Label>
            <Select value={selectedAcc} onValueChange={setUserSelectedAcc}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите кабинет" />
              </SelectTrigger>
              <SelectContent>
                {cabinetsWithAcc.map((c) => (
                  <SelectItem key={c.id} value={c.adAccountId ?? ""}>
                    {c.name} — {c.adAccountId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 rounded-lg border bg-card/40 p-3 sm:grid-cols-[1fr,1fr,auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="pw-url">URL сайта</Label>
              <Input
                id="pw-url"
                placeholder="https://example.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                disabled={!selectedAcc || saving}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-label">Название (опционально)</Label>
              <Input
                id="pw-label"
                placeholder="Например: Импланты"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                disabled={!selectedAcc || saving}
              />
            </div>
            <Button
              onClick={() => void handleAdd()}
              disabled={!selectedAcc || saving || !newUrl.trim()}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Добавить
            </Button>
          </div>

          <div className="rounded-lg border">
            <div className="grid grid-cols-[1fr,160px,80px,80px] gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
              <div>URL и название</div>
              <div>Хост</div>
              <div className="text-center">Дефолт</div>
              <div className="text-right">Действия</div>
            </div>
            {loading ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Загрузка…
              </div>
            ) : websites.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                У этого кабинета пока нет привязанных сайтов. Добавьте хотя бы
                один — он автоматически станет дефолтным.
              </div>
            ) : (
              websites.map((site) => (
                <div
                  key={site.id}
                  className="grid grid-cols-[1fr,160px,80px,80px] items-center gap-2 border-b px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 truncate text-sm font-medium text-primary hover:underline"
                    >
                      {site.url}
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                    </a>
                    {site.label ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {site.label}
                      </div>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {hostOf(site.url) ?? "—"}
                  </div>
                  <div className="flex justify-center">
                    {site.is_default ? (
                      <Badge className="gap-1" variant="default">
                        <Star className="h-3 w-3 fill-current" />
                        Да
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleMakeDefault(site)}
                        disabled={saving}
                        className="h-7 gap-1 text-xs"
                      >
                        <StarOff className="h-3 w-3" />
                        Сделать
                      </Button>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPendingDelete(site)}
                      disabled={saving}
                      className="h-7 w-7"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
            <strong>Как это работает в Telegram-боте:</strong>
            <ul className="ml-4 mt-1 list-disc space-y-0.5">
              <li>
                Пришли видео/фото + ссылку на любой из привязанных доменов
                (можно с путём, например <code>/services/implants</code>) —
                кампания запустится именно на этот URL.
              </li>
              <li>
                Если домен из сообщения не в списке — бот возьмёт дефолтный
                сайт и продолжит запуск.
              </li>
              <li>
                Если URL в сообщении нет — используется дефолтный сайт
                автоматически.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сайт из whitelist?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.url}
              <br />
              После удаления бот не сможет запускать рекламу на этот домен
              (вернёт дефолтный сайт или откажет, если whitelist станет пуст).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ProjectWebsitesSettings;
