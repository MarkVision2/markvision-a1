import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Иконка слева в плашке. */
  icon: LucideIcon;
  /** Цвет плашки иконки. По умолчанию — success (зелёный). */
  iconAccent?: "success" | "pink" | "primary";
  /** Основной заголовок страницы (H1). */
  title: string;
  /** Подзаголовок под title — короткое описание/статус. */
  description?: React.ReactNode;
  /** Контролы справа (фильтры, кнопки). */
  actions?: React.ReactNode;
  /** Доп. контент под заголовком (например, прогресс месяца). */
  meta?: React.ReactNode;
  className?: string;
}

const ICON_ACCENT_CLS: Record<NonNullable<PageHeaderProps["iconAccent"]>, string> = {
  success: "bg-success/10 text-success",
  pink: "bg-pink-500/10 text-pink-500",
  primary: "bg-primary/10 text-primary",
};

/**
 * Единый шапка-блок для всех страниц приложения.
 * Один размер иконки-плашки, один размер H1, один отступ.
 */
export function PageHeader({
  icon: Icon,
  iconAccent = "success",
  title,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", ICON_ACCENT_CLS[iconAccent])}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>

      {(actions || meta) && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          {meta}
          {actions}
        </div>
      )}
    </header>
  );
}

export default PageHeader;
