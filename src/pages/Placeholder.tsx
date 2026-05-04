import { type LucideIcon } from "lucide-react";

interface PlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

const Placeholder = ({ icon: Icon, title, description }: PlaceholderProps) => (
  <main className="container max-w-3xl py-16 animate-fade-in-up">
    <div className="flex flex-col items-center text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-success/10 text-success">
        <Icon className="h-7 w-7" />
      </span>
      <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
        {description}
      </p>
      <span className="mt-6 inline-flex items-center rounded-full border border-border/60 bg-card/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        В разработке
      </span>
    </div>
  </main>
);

export default Placeholder;