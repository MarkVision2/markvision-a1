import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Languages, ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEGAL_DOCS, LEGAL_ORG, type LegalDoc, type LegalLang, splitBody } from "@/data/legalContent";

const LANG_KEY = "mv.legal.lang";

function readLang(): LegalLang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "en" || stored === "ru") return stored;
  } catch { /* приватный режим */ }
  return /^en/i.test(navigator.language) ? "en" : "ru";
}

/**
 * Публичные страницы /terms и /privacy: без авторизации, без шапки приложения,
 * с оглавлением и переключателем RU/EN. Их адреса указываются в кабинетах
 * разработчика площадок.
 */
export default function Legal({ doc }: { doc: LegalDoc }) {
  const [lang, setLang] = useState<LegalLang>(readLang);
  const content = LEGAL_DOCS[doc][lang];
  const other: LegalDoc = doc === "terms" ? "privacy" : "terms";
  const Icon = doc === "privacy" ? ShieldCheck : FileText;

  useEffect(() => {
    const prev = document.title;
    document.title = `${content.title} — ${LEGAL_ORG.brand}`;
    return () => { document.title = prev; };
  }, [content.title]);

  const toggle = () => {
    const next: LegalLang = lang === "ru" ? "en" : "ru";
    setLang(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* приватный режим */ }
  };

  const sections = useMemo(() => content.sections.map((s) => ({ ...s, items: splitBody(s.body) })), [content]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-success/20 text-success ring-1 ring-success/40"><Zap className="h-4 w-4" /></span>
            {LEGAL_ORG.brand}
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link to={`/${other}`} className="rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              {LEGAL_DOCS[other][lang].title}
            </Link>
            <button type="button" onClick={toggle} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 hover:bg-muted" aria-label="Language">
              <Languages className="h-4 w-4" />{lang === "ru" ? "EN" : "RU"}
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="mb-10 flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-success/10 text-success"><Icon className="h-6 w-6" /></span>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{content.title}</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">{content.subtitle}</p>
            <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">{content.effective}</p>
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-[240px_1fr]">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <nav aria-label={lang === "ru" ? "Оглавление" : "Contents"} className="rounded-2xl border bg-card p-3 text-sm">
              <ul className="space-y-0.5">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="block rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">{s.title}</a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <article className="space-y-8">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <h2 className="text-xl font-bold tracking-tight">{s.title}</h2>
                <div className="mt-3 space-y-2.5 text-[15px] leading-relaxed text-foreground/90">
                  {groupItems(s.items).map((g, i) => g.kind === "ul" ? (
                    <ul key={i} className="list-disc space-y-1.5 pl-5">
                      {g.items.map((li, j) => <li key={j}>{li}</li>)}
                    </ul>
                  ) : (
                    <p key={i}>{g.text}</p>
                  ))}
                </div>
              </section>
            ))}

            <footer className={cn("space-y-1 border-t pt-6 text-xs text-muted-foreground")}>
              <div>© {new Date().getFullYear()} {LEGAL_ORG.entity[lang]}. {lang === "ru" ? "Все права защищены." : "All rights reserved."}</div>
              <div>{lang === "ru" ? "БИН" : "BIN"} {LEGAL_ORG.bin} · {LEGAL_ORG.address[lang]}</div>
              <div>
                <a href={`mailto:${LEGAL_ORG.email}`} className="underline underline-offset-2">{LEGAL_ORG.email}</a>
                {" · "}
                <a href={LEGAL_ORG.site} className="underline underline-offset-2">{LEGAL_ORG.site.replace(/^https?:\/\//, "")}</a>
              </div>
            </footer>
          </article>
        </div>
      </main>
    </div>
  );
}

type Group = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/** Подряд идущие пункты списка — в один <ul>. */
function groupItems(items: { kind: "p" | "li"; text: string }[]): Group[] {
  const out: Group[] = [];
  for (const it of items) {
    if (it.kind === "li") {
      const last = out[out.length - 1];
      if (last && last.kind === "ul") last.items.push(it.text);
      else out.push({ kind: "ul", items: [it.text] });
    } else {
      out.push({ kind: "p", text: it.text });
    }
  }
  return out;
}
