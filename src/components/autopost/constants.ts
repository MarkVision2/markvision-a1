import { AlertCircle, CheckCircle2, Clock, Film, FlaskConical, Images, Loader2 } from "lucide-react";

export type PostType = "IMAGE" | "REELS" | "CAROUSEL" | "STORIES";

export const TYPE_META: Record<PostType, { label: string; icon: typeof Images; accept: string; multiple: boolean; hint: string; aspect: string }> = {
  IMAGE: { label: "Пост", icon: Images, accept: "image/jpeg,image/png,image/webp", multiple: false, hint: "JPEG/PNG · кадр ленты 4:5 (обрежете перед публикацией)", aspect: "4:5" },
  REELS: { label: "Reels", icon: Film, accept: "video/mp4,video/quicktime", multiple: false, hint: "MP4 · вертикальное 9:16 · 5–90 сек", aspect: "9:16" },
  CAROUSEL: { label: "Карусель", icon: Images, accept: "image/jpeg,image/png,image/webp,video/mp4", multiple: true, hint: "2–10 слайдов · каждый фото-кадр 4:5", aspect: "4:5" },
  STORIES: { label: "Сторис", icon: Clock, accept: "image/jpeg,image/png,image/webp,video/mp4", multiple: false, hint: "Вертикальное фото или видео 9:16", aspect: "9:16" },
};

export const STATUS_META: Record<string, { label: string; dot: string; cls: string; icon: typeof Clock }> = {
  queued: { label: "В очереди", dot: "bg-sky-500", cls: "bg-sky-500/10 text-sky-600", icon: Clock },
  processing: { label: "Обрабатывается", dot: "bg-amber-500", cls: "bg-amber-500/10 text-amber-600", icon: Loader2 },
  published: { label: "Опубликовано", dot: "bg-emerald-500", cls: "bg-emerald-500/10 text-emerald-600", icon: CheckCircle2 },
  tested: { label: "Проверено (тест)", dot: "bg-violet-500", cls: "bg-violet-500/10 text-violet-600", icon: FlaskConical },
  failed: { label: "Ошибка", dot: "bg-destructive", cls: "bg-destructive/10 text-destructive", icon: AlertCircle },
};
