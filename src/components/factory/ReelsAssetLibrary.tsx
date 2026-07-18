import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, FileImage, Film, Folder, FolderPlus, Loader2, Plus, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  createReelsAssetFolder,
  deleteReelsAsset,
  deleteReelsAssetFolder,
  fetchReelsAssetFolders,
  fetchReelsAssets,
  uploadReelsAsset,
  type ReelsAssetFolder,
} from "@/lib/reelsAssets";

export function ReelsAssetLibrary({
  projectId,
  selectedFolderIds,
  onSelectionChange,
}: {
  projectId: string;
  selectedFolderIds: string[];
  onSelectionChange: (ids: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const [activeFolderId, setActiveFolderId] = useState("");
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const foldersQ = useQuery({
    queryKey: ["reels-asset-folders", projectId],
    queryFn: () => fetchReelsAssetFolders(projectId),
    enabled: !!projectId,
  });
  const folders = foldersQ.data ?? [];

  useEffect(() => {
    if (activeFolderId && folders.some((folder) => folder.id === activeFolderId)) return;
    setActiveFolderId(folders[0]?.id ?? "");
  }, [folders, activeFolderId]);

  const assetsQ = useQuery({
    queryKey: ["reels-assets", activeFolderId],
    queryFn: () => fetchReelsAssets(activeFolderId),
    enabled: !!activeFolderId,
  });

  const createFolderM = useMutation({
    mutationFn: () => createReelsAssetFolder(projectId, folderName),
    onSuccess: (folder) => {
      setFolderName("");
      setCreating(false);
      setActiveFolderId(folder.id);
      void queryClient.invalidateQueries({ queryKey: ["reels-asset-folders", projectId] });
      toast.success("Папка создана");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const toggleFolder = (id: string) => {
    onSelectionChange(
      selectedFolderIds.includes(id)
        ? selectedFolderIds.filter((folderId) => folderId !== id)
        : [...selectedFolderIds, id],
    );
  };

  const removeFolder = async (folder: ReelsAssetFolder) => {
    if (!confirm(`Удалить папку «${folder.name}» и все файлы внутри?`)) return;
    try {
      await deleteReelsAssetFolder(folder);
      onSelectionChange(selectedFolderIds.filter((id) => id !== folder.id));
      await queryClient.invalidateQueries({ queryKey: ["reels-asset-folders", projectId] });
      toast.success("Папка удалена");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !activeFolderId) return;
    setUploading(true);
    const list = Array.from(files);
    let success = 0;
    try {
      for (let index = 0; index < list.length; index += 1) {
        setUploadLabel(`${index + 1} из ${list.length}: ${list[index].name}`);
        try {
          await uploadReelsAsset(projectId, activeFolderId, list[index]);
          success += 1;
        } catch (error) {
          toast.error(`${list[index].name}: ${(error as Error).message}`);
        }
      }
      if (success) {
        toast.success(`Загружено файлов: ${success}`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["reels-assets", activeFolderId] }),
          queryClient.invalidateQueries({ queryKey: ["reels-asset-folders", projectId] }),
        ]);
      }
    } finally {
      setUploading(false);
      setUploadLabel("");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAsset = async (asset: NonNullable<typeof assetsQ.data>[number]) => {
    try {
      await deleteReelsAsset(asset);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reels-assets", activeFolderId] }),
        queryClient.invalidateQueries({ queryKey: ["reels-asset-folders", projectId] }),
      ]);
      toast.success("Файл удалён");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  if (!projectId) {
    return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Сначала выберите проект.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Папки проекта</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Отмеченные папки используются как случайный пул B-roll при создании Reels.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
          <FolderPlus className="h-4 w-4" /> Новая папка
        </Button>
      </div>

      {creating && (
        <div className="flex gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <Input
            autoFocus
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && folderName.trim()) createFolderM.mutate();
              if (event.key === "Escape") setCreating(false);
            }}
            placeholder="Например: Клиника, Команда, Интерьер"
            maxLength={80}
          />
          <Button type="button" disabled={!folderName.trim() || createFolderM.isPending} onClick={() => createFolderM.mutate()}>
            {createFolderM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => setCreating(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {foldersQ.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем папки…
        </div>
      ) : folders.length === 0 ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center transition hover:border-primary/50 hover:bg-primary/5"
        >
          <FolderPlus className="h-7 w-7 text-primary" />
          <span className="text-sm font-semibold">Создайте первую папку B-roll</span>
          <span className="text-xs text-muted-foreground">Загрузите свои видео, нарезки, фото и готовые вставки</span>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {folders.map((folder) => {
            const selected = selectedFolderIds.includes(folder.id);
            const active = activeFolderId === folder.id;
            return (
              <div
                key={folder.id}
                className={cn(
                  "group rounded-xl border p-3 transition",
                  active ? "border-primary/50 bg-primary/5" : "border-border/60 bg-background hover:border-primary/30",
                )}
              >
                <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setActiveFolderId(folder.id)}>
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", selected ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
                    <Folder className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{folder.name}</span>
                    <span className="text-[11px] text-muted-foreground">{folder.asset_count ?? 0} файлов</span>
                  </span>
                </button>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder.id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {selected ? "Выбрана для Reels" : "Использовать"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Удалить папку ${folder.name}`}
                    onClick={() => void removeFolder(folder)}
                    className="rounded-lg border border-border/60 p-1.5 text-muted-foreground opacity-60 transition hover:border-destructive/40 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeFolderId && (
        <div className="rounded-2xl border border-border/60 bg-background/60 p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">
                {folders.find((folder) => folder.id === activeFolderId)?.name ?? "Файлы"}
              </h4>
              <p className="text-[11px] text-muted-foreground">MP4, MOV, WebM, JPG, PNG, WebP · до 45 МБ на файл</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => void uploadFiles(event.target.files)}
            />
            <Button type="button" size="sm" className="gap-1.5" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? uploadLabel : "Загрузить файлы"}
            </Button>
          </div>

          {assetsQ.isLoading ? (
            <div className="flex items-center gap-2 py-5 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаем файлы…
            </div>
          ) : (assetsQ.data ?? []).length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-border/60 py-7 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <Upload className="h-5 w-5" />
              Загрузить B-roll в эту папку
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(assetsQ.data ?? []).map((asset) => (
                <article key={asset.id} className="group relative overflow-hidden rounded-xl border border-border/60 bg-card">
                  <div className="aspect-video bg-black/20">
                    {asset.media_type === "video" ? (
                      <video src={asset.public_url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      <img src={asset.public_url} alt={asset.name} loading="lazy" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 p-2">
                    {asset.media_type === "video" ? <Film className="h-3.5 w-3.5 shrink-0 text-primary" /> : <FileImage className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{asset.name}</span>
                    <button
                      type="button"
                      aria-label={`Удалить ${asset.name}`}
                      onClick={() => void removeAsset(asset)}
                      className="rounded p-1 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
