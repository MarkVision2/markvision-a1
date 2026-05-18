import { cn } from "@/lib/utils";

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  /** Расширенный режим для финансов/широких таблиц (max-w 1600). */
  wide?: boolean;
  /** Убрать анимацию появления (для страниц с локальным flow). */
  noAnimate?: boolean;
}

/**
 * Единая обёртка контента страницы.
 * Один max-width, одни паддинги, одно поведение на всё приложение.
 */
export function PageContainer({
  children,
  className,
  wide = false,
  noAnimate = false,
}: PageContainerProps) {
  return (
    <main
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8",
        wide ? "max-w-[1600px]" : "max-w-[1400px]",
        !noAnimate && "animate-fade-in-up",
        className,
      )}
    >
      {children}
    </main>
  );
}

export default PageContainer;
