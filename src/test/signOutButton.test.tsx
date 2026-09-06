/**
 * Кнопка «Выйти из аккаунта» в Настройках: подтверждение, гашение сессии Supabase
 * и возврат на страницу входа /login.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SignOutButton } from "@/components/settings/SignOutButton";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

const signOut = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signOut, user: { email: "ivan@markvision.kz" } }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  navigate.mockReset();
  signOut.mockReset().mockResolvedValue(undefined);
});

const renderButton = () =>
  render(
    <MemoryRouter>
      <SignOutButton />
    </MemoryRouter>,
  );

describe("SignOutButton", () => {
  it("спрашивает подтверждение перед выходом", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /выйти из аккаунта/i }));
    expect(screen.getByText(/Выйти из аккаунта\?/)).toBeInTheDocument();
    expect(screen.getByText(/ivan@markvision\.kz/)).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("гасит сессию и уводит на /login", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /выйти из аккаунта/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Выйти$/ }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("не уводит со страницы, если выход не удался", async () => {
    signOut.mockRejectedValueOnce(new Error("network"));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /выйти из аккаунта/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Выйти$/ }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(navigate).not.toHaveBeenCalled();
  });
});
