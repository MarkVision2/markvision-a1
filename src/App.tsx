import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import AppLayout from "./components/layout/AppLayout";
import { AuthProvider } from "./hooks/useAuth";
import { RequireAuth } from "./components/auth/RequireAuth";

// Lazy imports stored as factories so we can both render them and
// prefetch their chunks during idle time after first paint.
const lazyImports = {
  NotFound: () => import("./pages/NotFound.tsx"),
  CreateStep1: () => import("./pages/CreateStep1.tsx"),
  CreateStep2: () => import("./pages/CreateStep2.tsx"),
  CreateStep3: () => import("./pages/CreateStep3.tsx"),
  Ads: () => import("./pages/Ads.tsx"),
  Dashboard: () => import("./pages/Dashboard.tsx"),
  Metrics: () => import("./pages/Metrics.tsx"),
  Crm: () => import("./pages/Crm.tsx"),
  Calls: () => import("./pages/Calls.tsx"),
  Analytics: () => import("./pages/Analytics.tsx"),
  Finance: () => import("./pages/Finance.tsx"),
  Reports: () => import("./pages/Reports.tsx"),
  Settings: () => import("./pages/Settings.tsx"),
  SettingsConnection: () => import("./pages/SettingsConnection.tsx"),
  ResetPassword: () => import("./pages/ResetPassword.tsx"),
  ProjectStrategy: () => import("./pages/ProjectStrategy.tsx"),
};

const NotFound = lazy(lazyImports.NotFound);
const CreateStep1 = lazy(lazyImports.CreateStep1);
const CreateStep2 = lazy(lazyImports.CreateStep2);
const CreateStep3 = lazy(lazyImports.CreateStep3);
const Ads = lazy(lazyImports.Ads);
const Dashboard = lazy(lazyImports.Dashboard);
const Metrics = lazy(lazyImports.Metrics);
const Crm = lazy(lazyImports.Crm);
const CallsHistory = lazy(lazyImports.Calls);
const Analytics = lazy(lazyImports.Analytics);
const Finance = lazy(lazyImports.Finance);
const Reports = lazy(lazyImports.Reports);
const Settings = lazy(lazyImports.Settings);
const SettingsConnection = lazy(lazyImports.SettingsConnection);
const ResetPassword = lazy(lazyImports.ResetPassword);
const ProjectStrategy = lazy(lazyImports.ProjectStrategy);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Кешируем ответы на 5 минут — повторное открытие страниц
      // отрисовывается мгновенно из кеша, фоновое обновление подтянет свежие данные.
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="grid h-[60vh] w-full place-items-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

function ChunkPrefetcher() {
  useEffect(() => {
    const idle =
      (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
        .requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 800));
    idle(() => {
      // Прогреваем все маршруты в фоне, чтобы клик по сайдбару открывал страницу мгновенно.
      Object.values(lazyImports).forEach((load) => {
        load().catch(() => {});
      });
    });
  }, []);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ChunkPrefetcher />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/" element={<RequireAuth><AppLayout><Index /></AppLayout></RequireAuth>} />
              <Route path="/dashboard" element={<RequireAuth><AppLayout><Dashboard /></AppLayout></RequireAuth>} />
              <Route path="/metrics" element={<RequireAuth><AppLayout><Metrics /></AppLayout></RequireAuth>} />
              <Route path="/ads" element={<RequireAuth><AppLayout><Ads /></AppLayout></RequireAuth>} />
              <Route path="/crm" element={<RequireAuth><AppLayout><Crm /></AppLayout></RequireAuth>} />
              <Route path="/calls" element={<RequireAuth><AppLayout><CallsHistory /></AppLayout></RequireAuth>} />
              <Route path="/analytics" element={<RequireAuth><AppLayout><Analytics /></AppLayout></RequireAuth>} />
              <Route path="/finance" element={<RequireAuth><AppLayout><Finance /></AppLayout></RequireAuth>} />
              <Route path="/reports" element={<RequireAuth><AppLayout><Reports /></AppLayout></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth><AppLayout><Settings /></AppLayout></RequireAuth>} />
              <Route path="/settings/connection" element={<RequireAuth><AppLayout><SettingsConnection /></AppLayout></RequireAuth>} />
              <Route path="/create/step-1" element={<RequireAuth><AppLayout><CreateStep1 /></AppLayout></RequireAuth>} />
              <Route path="/create/step-2" element={<RequireAuth><AppLayout><CreateStep2 /></AppLayout></RequireAuth>} />
              <Route path="/create/step-3" element={<RequireAuth><AppLayout><CreateStep3 /></AppLayout></RequireAuth>} />
              <Route path="/projects/:id/strategy" element={<RequireAuth><AppLayout><ProjectStrategy /></AppLayout></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
