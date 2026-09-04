/**
 * Заливка ролика в «Публикациях»: проверка файла до отправки и подпись размера.
 * Ошибка здесь = оператор ждёт заливку гигабайта, чтобы площадка отказала.
 */
import { describe, it, expect } from "vitest";
import { formatBytes, validateVideoFile } from "@/lib/publishingUpload";

const file = (name: string, type: string, size = 1024): File => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("validateVideoFile", () => {
  it("пропускает mp4 и mov", () => {
    expect(validateVideoFile(file("reel.mp4", "video/mp4"))).toBeNull();
    expect(validateVideoFile(file("reel.MOV", "video/quicktime"))).toBeNull();
  });

  it("пропускает файл без MIME, но с верным расширением (частый случай в Windows)", () => {
    expect(validateVideoFile(file("reel.mp4", ""))).toBeNull();
  });

  it("отклоняет не-видео", () => {
    expect(validateVideoFile(file("photo.jpg", "image/jpeg"))).toMatch(/mp4 или .mov/);
    expect(validateVideoFile(file("doc.pdf", "application/pdf"))).toMatch(/mp4 или .mov/);
  });

  it("отклоняет видеоформаты, которые площадки не берут", () => {
    expect(validateVideoFile(file("clip.webm", "video/webm"))).toMatch(/только .mp4 и .mov/);
    expect(validateVideoFile(file("clip.mkv", "video/x-matroska"))).toMatch(/только .mp4 и .mov/);
  });

  it("отклоняет пустой файл", () => {
    expect(validateVideoFile(file("reel.mp4", "video/mp4", 0))).toMatch(/пустой/);
  });
});

describe("formatBytes", () => {
  it("подписывает размер в КБ/МБ/ГБ", () => {
    expect(formatBytes(2048)).toBe("2 КБ");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5 МБ");
    expect(formatBytes(Math.round(1.5 * 1024 ** 3))).toBe("1,5 ГБ");
  });
});
