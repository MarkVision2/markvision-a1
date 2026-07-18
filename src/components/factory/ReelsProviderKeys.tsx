import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  fetchReelsProviderStatus,
  removeReelsProviderKey,
  saveReelsProviderKey,
  type ReelsProvider,
} from "@/lib/reelsProviderSettings";

const PROVIDERS: {
  id: ReelsProvider;
  name: string;
  description: string;
  docs: string;
  placeholder: string;
}[] = [
  {
    id: "pexels",
    name: "Pexels",
    description: "Бесплатные стоковые вертикальные видео по смыслу сценария",
    docs: "https://www.pexels.com/api/",
    placeholder: "Вставьте Pexels API key",
  },
  {
    id: "kie",
    name: "Kie.ai",
    description: "Генерация уникальных видеовставок через Kling 2.1",
    docs: "https://kie.ai/api-key",
    placeholder: "Вставьте Kie.ai API key",
  },
];

export function ReelsProviderKeys({
  projectId,
}: {
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [keys, setKeys] = useState<Partial<Record<ReelsProvider, string>>>({});
  const [visible, setVisible] = useState<Partial<Record<ReelsProvider, boolean>>>({});
  const [saving, setSaving] = useState<ReelsProvider | null>(null);

  const statusQ = useQuery({
    queryKey: ["reels-provider-status", projectId],
    queryFn: () => fetchReelsProviderStatus(projectId),
    enabled: !!projectId,
  });
  const status = statusQ.data;

  useEffect(() => {
    setKeys({});
    setVisible({});
  }, [projectId]);

  const save = async (provider: ReelsProvider) => {
    const apiKey = keys[provider]?.trim() ?? "";
    if (!apiKey) return;
    setSaving(provider);
    try {
      await saveReelsProviderKey(projectId, provider, apiKey);
      setKeys((current) => ({ ...current, [provider]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["reels-provider-status", projectId] });
      toast.success(`${provider === "pexels" ? "Pexels" : "Kie.ai"} подключён`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const remove = async (provider: ReelsProvider) => {
    if (!confirm(`Удалить ключ ${provider === "pexels" ? "Pexels" : "Kie.ai"} из проекта?`)) return;
    setSaving(provider);
    try {
      await removeReelsProviderKey(projectId, provider);
      await queryClient.invalidateQueries({ queryKey: ["reels-provider-status", projectId] });
      toast.success("Ключ удалён");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Источники B-roll</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Ключи проверяются на сервере, хранятся зашифрованными и никогда не попадают в браузер или заявку.
        </p>
      </div>

      {statusQ.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Проверяем подключения…
        </div>
      )}
      {statusQ.error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Не удалось загрузить настройки: {(statusQ.error as Error).message}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const connected = status?.[provider.id]?.connected;
          return (
            <section key={provider.id} className="rounded-2xl border border-border/60 bg-background/60 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <KeyRound className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold">{provider.name}</h4>
                    {connected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> Подключён {status?.[provider.id]?.key_hint}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{provider.description}</p>
                </div>
              </div>

              <div className="relative mt-4">
                <Input
                  type={visible[provider.id] ? "text" : "password"}
                  value={keys[provider.id] ?? ""}
                  onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))}
                  placeholder={connected ? "Вставьте новый ключ для замены" : provider.placeholder}
                  autoComplete="off"
                  className="pr-10"
                />
                <button
                  type="button"
                  aria-label={visible[provider.id] ? "Скрыть ключ" : "Показать ключ"}
                  onClick={() => setVisible((current) => ({ ...current, [provider.id]: !current[provider.id] }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {visible[provider.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={!keys[provider.id]?.trim() || saving === provider.id}
                  onClick={() => void save(provider.id)}
                >
                  {saving === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {connected ? "Заменить ключ" : "Проверить и сохранить"}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                  <a href={provider.docs} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" /> Получить ключ
                  </a>
                </Button>
                {connected && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                    disabled={saving === provider.id}
                    onClick={() => void remove(provider.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Удалить
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
