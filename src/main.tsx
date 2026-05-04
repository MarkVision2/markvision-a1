import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Авто-восстановление от stale chunks после деплоя: если браузер держит
// старый index.js, ссылающийся на удалённый чанк, перезагружаем страницу
// один раз, чтобы подтянуть актуальный билд.
const isChunkLoadError = (msg: string) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(
    msg,
  );
const reloadOnce = () => {
  const KEY = "__chunk_reload_at";
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 10_000) return; // защита от цикла
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
};
window.addEventListener("error", (e) => {
  if (e?.message && isChunkLoadError(e.message)) reloadOnce();
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = (e?.reason && (e.reason.message || String(e.reason))) || "";
  if (isChunkLoadError(msg)) reloadOnce();
});

createRoot(document.getElementById("root")!).render(<App />);
