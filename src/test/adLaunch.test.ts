import { describe, expect, it, vi } from "vitest";
import { waitForLaunchRow } from "@/lib/adLaunch";

const noSleep = () => Promise.resolve();

describe("waitForLaunchRow", () => {
  it("подтверждает запуск, если строка нашлась с первой попытки", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const ok = await waitForLaunchRow("launch-1", probe, { sleep: noSleep });
    expect(ok).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("повторяет опрос, пока строка не появится", async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const ok = await waitForLaunchRow("launch-2", probe, {
      attempts: 5,
      sleep: noSleep,
    });
    expect(ok).toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("не выдаёт таймаут за успех: строки нет — запуск не подтверждён", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const ok = await waitForLaunchRow("launch-3", probe, {
      attempts: 3,
      sleep: noSleep,
    });
    expect(ok).toBe(false);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("переживает сетевую ошибку в опросе и пробует снова", async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(true);
    const ok = await waitForLaunchRow("launch-4", probe, {
      attempts: 3,
      sleep: noSleep,
    });
    expect(ok).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("без launchId не ходит в БД вообще", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    expect(await waitForLaunchRow("", probe, { sleep: noSleep })).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});
