import { X, Zap, Infinity as InfinityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  onClose?: () => void;
}

const Header = ({ onClose }: HeaderProps) => {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-14 items-center justify-between">
        <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-primary shadow-glow">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="text-sm sm:text-base">
            MarkVision<span className="text-muted-foreground"> AI</span>
          </span>
        </a>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary/60 px-3 py-1 text-xs sm:text-sm">
            <Zap className="h-3.5 w-3.5 text-warning" aria-hidden />
            <span className="text-muted-foreground hidden sm:inline">Доступ:</span>
            <InfinityIcon className="h-4 w-4 text-foreground" aria-label="безлимит" />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Закрыть"
            onClick={onClose}
            className="h-9 w-9 rounded-full hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;