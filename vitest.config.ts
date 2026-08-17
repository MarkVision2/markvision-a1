import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    testTimeout: 15_000,
    // Бизнес-логика (CRM day-keys) считает по Asia/Almaty. Фиксируем TZ, иначе
    // на UTC-раннерах (GitHub Actions) даты «уезжают» и тесты падают недетерминированно.
    env: { TZ: "Asia/Almaty" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
