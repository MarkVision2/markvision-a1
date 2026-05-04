interface Props {
  children: React.ReactNode;
}
export function SectionTitle({ children }: Props) {
  return (
    <div className="mb-5 flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_hsl(var(--success))]" />
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-foreground/90">
        {children}
      </h2>
    </div>
  );
}