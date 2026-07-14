import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "./hooks/useAuth";
import { RequireAuth } from "./components/auth/RequireAuth";
import { routeImports } from "./lib/routePrefetch";

const AppLayout = lazy(routeImports.AppLayout);
const NotFound = lazy(routeImports.NotFound);
const Index = lazy(routeImports.Index);
const Login = lazy(routeImports.Login);
const Lab = lazy(routeImports.Lab);
const CreateStep1 = lazy(routeImports.CreateStep1);
const CreateStep2 = lazy(routeImports.CreateStep2);
const CreateStep3 = lazy(routeImports.CreateStep3);
const CreateNeuroPhoto = lazy(routeImports.CreateNeuroPhoto);
const CreateMontage = lazy(routeImports.CreateMontage);
const CreateReels = lazy(routeImports.CreateReels);
const Ads = lazy(routeImports.Ads);
const Dashboard = lazy(routeImports.Dashboard);
const Metrics = lazy(routeImports.Metrics);
const Crm = lazy(routeImports.Crm);
const CallsHistory = lazy(routeImports.Calls);
const SalesAI = lazy(routeImports.SalesAI);
const AiAgents = lazy(routeImports.AiAgents);
const Broadcasts = lazy(routeImports.Broadcasts);
const Analytics = lazy(routeImports.Analytics);
const CreativeFunnel = lazy(routeImports.CreativeFunnel);
const ContentAnalytics = lazy(routeImports.ContentAnalytics);
const ContentCenter = lazy(routeImports.ContentCenter);
const AutoPost = lazy(routeImports.AutoPost);
const Finance = lazy(routeImports.Finance);
const Reports = lazy(routeImports.Reports);
const Settings = lazy(routeImports.Settings);
const SettingsConnection = lazy(routeImports.SettingsConnection);
const ResetPassword = lazy(routeImports.ResetPassword);
const ProjectStrategy = lazy(routeImports.ProjectStrategy);
const ClientDashboard = lazy(routeImports.ClientDashboard);
const ProjectIntegrationWizard = lazy(routeImports.ProjectIntegrationWizard);

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
              <Route path="/lab" element={<Lab />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/client/:token" element={<ClientDashboard />} />
              <Route path="/" element={<RequireAuth><AppLayout><Index /></AppLayout></RequireAuth>} />
              <Route path="/dashboard" element={<RequireAuth><AppLayout><Dashboard /></AppLayout></RequireAuth>} />
              <Route path="/metrics" element={<RequireAuth><AppLayout><Metrics /></AppLayout></RequireAuth>} />
              <Route path="/ads" element={<RequireAuth><AppLayout><Ads /></AppLayout></RequireAuth>} />
              <Route path="/crm" element={<RequireAuth><AppLayout><Crm /></AppLayout></RequireAuth>} />
              <Route path="/calls" element={<RequireAuth><AppLayout><CallsHistory /></AppLayout></RequireAuth>} />
              <Route path="/sales-ai" element={<RequireAuth><AppLayout><SalesAI /></AppLayout></RequireAuth>} />
              <Route path="/ai-agents" element={<RequireAuth><AppLayout><AiAgents /></AppLayout></RequireAuth>} />
              <Route path="/broadcasts" element={<RequireAuth><AppLayout><Broadcasts /></AppLayout></RequireAuth>} />
              <Route path="/analytics" element={<RequireAuth><AppLayout><Analytics /></AppLayout></RequireAuth>} />
              <Route path="/analytics/creatives" element={<RequireAuth><AppLayout><CreativeFunnel /></AppLayout></RequireAuth>} />
              <Route path="/analytics/content" element={<RequireAuth><AppLayout><ContentAnalytics /></AppLayout></RequireAuth>} />
              <Route path="/marketing/content-center" element={<RequireAuth><AppLayout><ContentCenter /></AppLayout></RequireAuth>} />
              <Route path="/marketing/autopost" element={<RequireAuth><AppLayout><AutoPost /></AppLayout></RequireAuth>} />
              <Route path="/finance" element={<RequireAuth><AppLayout><Finance /></AppLayout></RequireAuth>} />
              <Route path="/reports" element={<RequireAuth><AppLayout><Reports /></AppLayout></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth><AppLayout><Settings /></AppLayout></RequireAuth>} />
              <Route path="/settings/connection" element={<RequireAuth><AppLayout><SettingsConnection /></AppLayout></RequireAuth>} />
              <Route path="/create/step-1" element={<RequireAuth><AppLayout><CreateStep1 /></AppLayout></RequireAuth>} />
              <Route path="/create/step-2" element={<RequireAuth><AppLayout><CreateStep2 /></AppLayout></RequireAuth>} />
              <Route path="/create/step-3" element={<RequireAuth><AppLayout><CreateStep3 /></AppLayout></RequireAuth>} />
              <Route path="/create/neuro-photo" element={<RequireAuth><AppLayout><CreateNeuroPhoto /></AppLayout></RequireAuth>} />
              <Route path="/create/montage" element={<RequireAuth><AppLayout><CreateMontage /></AppLayout></RequireAuth>} />
              <Route path="/create/reels" element={<RequireAuth><AppLayout><CreateReels /></AppLayout></RequireAuth>} />
              <Route path="/projects/new" element={<RequireAuth><AppLayout><ProjectIntegrationWizard /></AppLayout></RequireAuth>} />
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
