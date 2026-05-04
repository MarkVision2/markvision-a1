import { lazy, Suspense } from "react";
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

// Code-split heavy/secondary pages so the first paint stays small.
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const CreateStep1 = lazy(() => import("./pages/CreateStep1.tsx"));
const CreateStep2 = lazy(() => import("./pages/CreateStep2.tsx"));
const CreateStep3 = lazy(() => import("./pages/CreateStep3.tsx"));
const Ads = lazy(() => import("./pages/Ads.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Metrics = lazy(() => import("./pages/Metrics.tsx"));
const Crm = lazy(() => import("./pages/Crm.tsx"));
const CallsHistory = lazy(() => import("./pages/Calls.tsx"));
const Analytics = lazy(() => import("./pages/Analytics.tsx"));
const Finance = lazy(() => import("./pages/Finance.tsx"));
const Reports = lazy(() => import("./pages/Reports.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const SettingsConnection = lazy(() => import("./pages/SettingsConnection.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="grid h-[60vh] w-full place-items-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// rev: auth-pages-3 + code-split
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
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
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
