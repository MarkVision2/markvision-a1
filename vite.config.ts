import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-router-dom") || id.includes("/react-router/")) return "router";
          if (id.includes("@tanstack/")) return "query";
          if (id.includes("@supabase/") || id.includes("@lovable.dev/cloud-auth-js")) return "supabase";
          if (id.includes("/recharts/") || id.includes("/d3-")) return "charts";
          if (
            id.includes("/react-markdown/") ||
            id.includes("/remark-") ||
            id.includes("/rehype-") ||
            id.includes("/micromark") ||
            id.includes("/mdast-") ||
            id.includes("/unist-") ||
            id.includes("/hast-util-") ||
            id.includes("/unified/") ||
            id.includes("/vfile/") ||
            id.includes("/decode-named-character-reference/")
          ) return "markdown";
          if (id.includes("/lucide-react/")) return "icons";
          if (id.includes("/@radix-ui/")) return "radix";
          if (id.includes("/react-hook-form/") || id.includes("/zod/") || id.includes("@hookform/")) return "forms";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/") ||
            id.includes("/react/jsx-runtime") ||
            id.includes("/react/jsx-dev-runtime")
          ) return "react";
          return undefined;
        },
      },
    },
  },
}));
