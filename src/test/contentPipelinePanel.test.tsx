/**
 * Карточка AI-видео в контент-плане: кнопки соответствуют состоянию,
 * блокируются во время запроса, отклонение требует комментарий.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PipelineDetail } from "@/lib/contentPipeline";
import { formatDuration, pipelineStepIndex, runDurationSeconds } from "@/lib/contentPipeline";

const hookState = vi.hoisted(() => ({
  detail: null as PipelineDetail | null,
  loading: false,
  error: null as string | null,
  busy: null as string | null,
  refetch: vi.fn(),
  generate: vi.fn(async () => hookState.detail!),
  approve: vi.fn(async () => hookState.detail!),
  reject: vi.fn(async () => hookState.detail!),
  retry: vi.fn(async () => hookState.detail!),
  cancel: vi.fn(async () => hookState.detail!),
}));

vi.mock("@/hooks/useContentPipeline", () => ({
  useContentPipeline: () => hookState,
}));

import { ContentPipelinePanel } from "@/components/content-plan/ContentPipelinePanel";

function detailWith(state: PipelineDetail["current_run"] extends infer R ? (R extends { state: infer S } ? S : never) : never | null, can: Partial<PipelineDetail["can"]> = {}): PipelineDetail {
  const run = state
    ? {
      id: "run-1",
      state,
      state_label: "",
      attempt: 2,
      provider: "heygen",
      provider_job_id: "hg-1",
      started_at: "2026-09-04T10:00:00Z",
      finished_at: null,
      state_changed_at: "2026-09-04T10:01:00Z",
      heartbeat_at: null,
      next_retry_at: null,
      error_code: state === "failed" ? "video_timeout" : null,
      error_user: state === "failed" ? "Генерация видео заняла слишком много времени." : null,
      error_at: null,
      cost_usd: 0.42,
      script: { hook: "Хук", script: "Полный текст ролика", title: "Заголовок", description: "Описание", hashtags: ["#a", "#b", "#c"] },
      model: "gpt-4o-mini",
      prompt_version: "v5.0",
      created_at: "2026-09-04T10:00:00Z",
    }
    : null;
  return {
    item: {
      id: "item-1", project_id: "p1", title: "Тема", description: null, prompts: null, category: "content",
      hashtags: null, status: "in_progress", media_url: null, created_at: "", updated_at: "",
    },
    current_run: run,
    script: run?.script ?? null,
    runs: run ? [run] : [],
    assets: [],
    reviews: [],
    can: { generate: false, review: false, retry: false, cancel: false, ...can },
  };
}

beforeEach(() => {
  hookState.loading = false;
  hookState.error = null;
  hookState.busy = null;
  vi.clearAllMocks();
});

describe("ContentPipelinePanel", () => {
  it("без запусков показывает «Сгенерировать»", () => {
    hookState.detail = detailWith(null, { generate: true });
    render(<ContentPipelinePanel itemId="item-1" />);
    expect(screen.getByRole("button", { name: /Сгенерировать/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Одобрить/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Сгенерировать/ }));
    expect(hookState.generate).toHaveBeenCalledTimes(1);
  });

  it("ожидание согласования: одобрить сразу, отклонить — только с комментарием", () => {
    hookState.detail = detailWith("awaiting_review", { review: true });
    render(<ContentPipelinePanel itemId="item-1" />);
    expect(screen.getAllByText("Ждёт согласования").length).toBeGreaterThan(0);
    expect(screen.getByText("Полный текст ролика")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Отклонить/ }));
    fireEvent.click(screen.getByRole("button", { name: /Отправить на переработку/ }));
    expect(hookState.reject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/слишком длинно/), { target: { value: "короче" } });
    fireEvent.click(screen.getByRole("button", { name: /Отправить на переработку/ }));
    expect(hookState.reject).toHaveBeenCalledWith("короче");

    fireEvent.click(screen.getByRole("button", { name: /Одобрить/ }));
    expect(hookState.approve).toHaveBeenCalledTimes(1);
  });

  it("ошибка: безопасный текст и «Повторить»; кнопки блокируются, пока идёт запрос", () => {
    hookState.detail = detailWith("failed", { retry: true });
    hookState.busy = "retry";
    render(<ContentPipelinePanel itemId="item-1" />);
    expect(screen.getAllByText(/слишком много времени/).length).toBeGreaterThan(0);
    const retry = screen.getByRole("button", { name: /Повторить/ });
    expect(retry).toBeDisabled();
  });

  it("активный этап рисует спиннер и длительность, отмена доступна", () => {
    hookState.detail = detailWith("video_rendering", { cancel: true });
    render(<ContentPipelinePanel itemId="item-1" />);
    expect(screen.getAllByText("Рендер видео").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Отменить/ })).toBeInTheDocument();
    expect(screen.getByText(/Попытка/)).toBeInTheDocument();
  });

  it("для не-Reels конвейер отключён", () => {
    hookState.detail = detailWith(null);
    render(<ContentPipelinePanel itemId="item-1" enabled={false} />);
    expect(screen.getByText(/только для типа Reels/)).toBeInTheDocument();
  });
});

describe("хелперы карточки", () => {
  it("шаги прогресса по этапу", () => {
    expect(pipelineStepIndex(null)).toBe(0);
    expect(pipelineStepIndex("script_generating")).toBe(1);
    expect(pipelineStepIndex("awaiting_review")).toBe(5);
    expect(pipelineStepIndex("approved")).toBe(6);
  });

  it("длительность запуска и формат", () => {
    const now = Date.parse("2026-09-04T10:05:30Z");
    expect(runDurationSeconds({ started_at: "2026-09-04T10:00:00Z", finished_at: null }, now)).toBe(330);
    expect(runDurationSeconds({ started_at: "2026-09-04T10:00:00Z", finished_at: "2026-09-04T10:00:45Z" }, now)).toBe(45);
    expect(formatDuration(45)).toBe("45 с");
    expect(formatDuration(330)).toBe("5 мин 30 с");
    expect(formatDuration(3720)).toBe("1 ч 2 мин");
  });
});
