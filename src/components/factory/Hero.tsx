import { Wand2 } from "lucide-react";

const Hero = () => (
  <section className="container px-3 pt-5 pb-1 sm:px-4 sm:pt-8">
    <div className="flex items-center gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary sm:h-12 sm:w-12">
        <Wand2 className="h-5 w-5 sm:h-6 sm:w-6" />
      </span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Контент-завод</h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          Выберите формат — соберём креатив под него: промт, структуру и стиль
        </p>
      </div>
    </div>
  </section>
);

export default Hero;
