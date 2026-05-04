const Hero = () => {
  return (
    <section className="container pt-6 pb-4 sm:pt-8 sm:pb-6 text-center animate-fade-in-up">
      <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/40 px-3 py-1 text-xs text-muted-foreground mb-4">
        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
        Контент-завод
      </div>
      <h1 className="mx-auto max-w-3xl text-balance text-2xl font-bold leading-[1.1] tracking-tight sm:text-3xl md:text-4xl">
        <span className="text-gradient">Создавайте конверсионные креативы</span>
      </h1>
      <p className="mx-auto mt-2 max-w-xl text-balance text-sm text-muted-foreground sm:text-base">
        Высокий CTR и дешевые клики без дизайнера и агентства
      </p>
    </section>
  );
};

export default Hero;