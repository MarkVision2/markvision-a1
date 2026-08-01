/**
 * Partner short-links: /p/:slug → landing with UTM.
 * https://www.markvision.kz/p/astana → zapoinovai + utm_source=astana_hub
 */
const PARTNERS: Record<string, string> = {
  hub: "https://zapoinovai.vercel.app/?utm_source=astana_hub&utm_medium=referral&utm_campaign=workshop_aug1",
  dastan: "https://zapoinovai.vercel.app/?utm_source=dastan&utm_medium=referral&utm_campaign=workshop_aug1",
  nadi: "https://zapoinovai.vercel.app/?utm_source=nadi&utm_medium=referral&utm_campaign=workshop_aug1",
};

export default async function handler(
  req: { method?: string; query?: Record<string, string | string[] | undefined> },
  res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (b?: string) => void;
  },
) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  const raw = req.query?.slug ?? req.query?.s;
  const slug = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().toLowerCase();
  const target = slug ? PARTNERS[slug] : undefined;

  if (!target) {
    res.statusCode = 404;
    res.end("Unknown partner link");
    return;
  }

  res.statusCode = 302;
  res.setHeader("Location", target);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
