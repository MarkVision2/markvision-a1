/**
 * Allowlist хостов для креативов.
 *
 * Воркер делает server-side fetch по этим ссылкам и отправляет байты в Meta.
 * Без проверки хоста это SSRF: ссылку в задание кладёт клиент (мастер запуска
 * или настройки кабинета), а ответ потом видно в готовом объявлении.
 */
import { describe, expect, it } from "vitest";
import {
  allowedMediaHosts,
  DEFAULT_MEDIA_HOSTS,
  isAllowedMediaUrl,
  partitionMediaUrls,
} from "../../supabase/functions/_lib/adLaunchMedia.ts";

const allowed = allowedMediaHosts();

describe("isAllowedMediaUrl", () => {
  it("пропускает наши хранилища", () => {
    expect(isAllowedMediaUrl("https://szfgdruhlebfvcmlvxdk.supabase.co/storage/v1/x.jpg", allowed)).toBe(true);
    expect(isAllowedMediaUrl("https://res.cloudinary.com/demo/image/upload/x.jpg", allowed)).toBe(true);
  });

  it("отклоняет чужой домен", () => {
    expect(isAllowedMediaUrl("https://evil.example.com/x.jpg", allowed)).toBe(false);
  });

  it("отклоняет внутренние адреса — это и есть SSRF", () => {
    expect(isAllowedMediaUrl("https://169.254.169.254/latest/meta-data/", allowed)).toBe(false);
    expect(isAllowedMediaUrl("https://127.0.0.1/admin", allowed)).toBe(false);
    expect(isAllowedMediaUrl("https://10.0.0.5/secret", allowed)).toBe(false);
    expect(isAllowedMediaUrl("https://localhost/x.jpg", allowed)).toBe(false);
    expect(isAllowedMediaUrl("https://[::1]/x.jpg", allowed)).toBe(false);
    expect(isAllowedMediaUrl("https://db.internal/x.jpg", allowed)).toBe(false);
  });

  it("отклоняет не-https схемы", () => {
    expect(isAllowedMediaUrl("http://szfgdruhlebfvcmlvxdk.supabase.co/x.jpg", allowed)).toBe(false);
    expect(isAllowedMediaUrl("file:///etc/passwd", allowed)).toBe(false);
    expect(isAllowedMediaUrl("javascript:alert(1)", allowed)).toBe(false);
    expect(isAllowedMediaUrl("data:image/png;base64,AAAA", allowed)).toBe(false);
  });

  it("не обманывается похожим доменом", () => {
    // Суффикс ".supabase.co" не должен пропускать evil-supabase.co
    expect(isAllowedMediaUrl("https://evil-supabase.co/x.jpg", allowed)).toBe(false);
    // ...и домен, где наш хост лишь часть пути или поддомена злоумышленника.
    expect(isAllowedMediaUrl("https://supabase.co.evil.com/x.jpg", allowed)).toBe(false);
    expect(isAllowedMediaUrl("https://evil.com/?u=res.cloudinary.com/x.jpg", allowed)).toBe(false);
  });

  it("мусор и пустая строка не проходят", () => {
    expect(isAllowedMediaUrl("", allowed)).toBe(false);
    expect(isAllowedMediaUrl("не ссылка", allowed)).toBe(false);
  });
});

describe("allowedMediaHosts", () => {
  it("расширяется переменной окружения", () => {
    const list = allowedMediaHosts("cdn.example.com, .my-cdn.net");
    expect(isAllowedMediaUrl("https://cdn.example.com/x.jpg", list)).toBe(true);
    expect(isAllowedMediaUrl("https://img.my-cdn.net/x.jpg", list)).toBe(true);
    expect(isAllowedMediaUrl("https://cdn.example.com/x.jpg", DEFAULT_MEDIA_HOSTS)).toBe(false);
  });

  it("пустое значение переменной ничего не ломает", () => {
    expect(allowedMediaHosts("")).toEqual(DEFAULT_MEDIA_HOSTS);
    expect(allowedMediaHosts(null)).toEqual(DEFAULT_MEDIA_HOSTS);
  });
});

describe("partitionMediaUrls", () => {
  it("делит ссылки, чтобы отклонённые можно было показать человеку", () => {
    const { accepted, rejected } = partitionMediaUrls(
      ["https://x.supabase.co/a.jpg", "https://evil.example.com/b.jpg"],
      allowed,
    );
    expect(accepted).toEqual(["https://x.supabase.co/a.jpg"]);
    expect(rejected).toEqual(["https://evil.example.com/b.jpg"]);
  });
});
