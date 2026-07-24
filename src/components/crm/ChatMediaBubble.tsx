import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/crm";

const PLACEHOLDER_RE = /^\[(Аудио|Изображение|Видео|Стикер|Файл|Сообщение|Документ)\]$/i;

function captionOf(m: ChatMessage): string | null {
  const t = (m.text ?? "").trim();
  if (!t || PLACEHOLDER_RE.test(t)) return null;
  return t;
}

function ImageLightbox({
  url,
  alt,
  open,
  onClose,
}: {
  url: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Закрыть"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={url}
        alt={alt}
        className="max-h-[92dvh] max-w-[min(96vw,1100px)] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

/** Renders WA/CRM media inside a chat bubble (audio player, image, video, file). */
export function ChatMediaBubble({
  message: m,
  fromMe,
}: {
  message: ChatMessage;
  fromMe?: boolean;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const caption = captionOf(m);
  const url = m.mediaUrl;
  const kind = m.mediaKind;
  const alt = caption || "Изображение";

  if (!url) {
    return <div className="whitespace-pre-wrap break-words">{m.text}</div>;
  }

  return (
    <div className="space-y-1.5">
      {(kind === "image" || kind === "sticker") ? (
        <>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block max-w-full cursor-zoom-in text-left"
            title="Открыть"
          >
            <img
              src={url}
              alt={alt}
              className="max-h-72 max-w-full rounded-lg object-contain"
              loading="lazy"
            />
          </button>
          <ImageLightbox
            url={url}
            alt={alt}
            open={lightboxOpen}
            onClose={() => setLightboxOpen(false)}
          />
        </>
      ) : kind === "audio" ? (
        <audio
          controls
          preload="metadata"
          src={url}
          className="w-full min-w-[200px] max-w-[280px]"
        />
      ) : kind === "video" ? (
        <video
          controls
          preload="metadata"
          src={url}
          className="max-h-72 max-w-full rounded-lg bg-black/40"
        />
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          download={m.mediaFilename || true}
          className={cn(
            "inline-flex max-w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium underline-offset-2 hover:underline",
            fromMe ? "bg-background/15" : "bg-background/50",
          )}
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{m.mediaFilename || "Файл"}</span>
          <Download className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </a>
      )}

      {caption && <div className="whitespace-pre-wrap break-words">{caption}</div>}
    </div>
  );
}

/** Short preview line for chat list. */
export function chatPreviewText(m: ChatMessage | undefined, fallbackPhone?: string): string {
  if (!m) return fallbackPhone || "";
  if (m.mediaKind === "audio") return "🎤 Голосовое";
  if (m.mediaKind === "image" || m.mediaKind === "sticker") return "🖼 Фото";
  if (m.mediaKind === "video") return "🎬 Видео";
  if (m.mediaKind === "document") return `📎 ${m.mediaFilename || "Файл"}`;
  if (PLACEHOLDER_RE.test((m.text ?? "").trim())) {
    const t = m.text.trim();
    if (t.includes("Аудио")) return "🎤 Голосовое";
    if (t.includes("Изображение") || t.includes("Стикер")) return "🖼 Фото";
    if (t.includes("Видео")) return "🎬 Видео";
    if (t.includes("Файл") || t.includes("Документ")) return "📎 Файл";
  }
  return m.text || fallbackPhone || "";
}
