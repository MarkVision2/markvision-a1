// Заглушки для проверки edge-функций обычным tsc (npm run typecheck:functions):
// Deno-глобалы и импорты по URL сопоставляются с установленным @supabase/supabase-js
// (paths в supabase/functions/_types/tsconfig.check.json). На деплой не влияет — Supabase
// собирает функции esbuild'ом без проверки типов, поэтому эта проверка и нужна.
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
  function test(name: string, fn: () => void | Promise<void>): void;
}
declare module "jsr:@std/assert@1" {
  export function assertEquals(actual: unknown, expected: unknown, msg?: string): void;
  export function assertMatch(actual: string, expected: RegExp, msg?: string): void;
}
