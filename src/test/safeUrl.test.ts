/**
 * Защита серверных запросов по пользовательским ссылкам.
 *
 * Контент-завод ходит на страницу товара, которую указал человек, — это
 * законная функция, allowlist тут не подходит. Но внутренние адреса должны
 * быть закрыты, иначе ответ из локальной сети уедет в промпт модели.
 */
import { describe, expect, it } from "vitest";
import {
  isPrivateHostname,
  isPublicHttpUrl,
} from "../../supabase/functions/_lib/safeUrl.ts";

describe("isPrivateHostname", () => {
  it("ловит локальные и служебные имена", () => {
    for (const host of ["localhost", "app.localhost", "db.internal", "printer.local", "x.home.arpa"]) {
      expect(isPrivateHostname(host)).toBe(true);
    }
  });

  it("ловит адреса-литералы во всех формах записи", () => {
    for (const host of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "[::1]", "2130706433", "0x7f000001"]) {
      expect(isPrivateHostname(host)).toBe(true);
    }
  });

  it("пустой хост считается небезопасным", () => {
    expect(isPrivateHostname("")).toBe(true);
    expect(isPrivateHostname("   ")).toBe(true);
  });

  it("обычные домены проходят", () => {
    for (const host of ["example.com", "shop.example.co.uk", "res.cloudinary.com"]) {
      expect(isPrivateHostname(host)).toBe(false);
    }
  });
});

describe("isPublicHttpUrl", () => {
  it("пропускает http и https на публичных доменах", () => {
    expect(isPublicHttpUrl("https://example.com/product")).toBe(true);
    expect(isPublicHttpUrl("http://example.com")).toBe(true);
  });

  it("отклоняет чужие схемы", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "ftp://example.com"]) {
      expect(isPublicHttpUrl(url)).toBe(false);
    }
  });

  it("отклоняет внутренние адреса", () => {
    expect(isPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isPublicHttpUrl("http://localhost:8000/admin")).toBe(false);
  });

  it("мусор и пустая строка не проходят", () => {
    expect(isPublicHttpUrl("")).toBe(false);
    expect(isPublicHttpUrl("просто текст")).toBe(false);
  });
});
