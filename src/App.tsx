import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "./hooks/useAuth";
import { RequireAuth } from "./components/auth/RequireAuth";
import { RequireModule } from "./components/auth/RequireModule";
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
const CreateMontageLab = lazy(routeImports.CreateMontageLab);
const CreateReels = lazy(routeImports.CreateReels);
const Ads = lazy(routeImports.Ads);
const Dashboard = lazy(routeImports.Dashboard);
const Metrics = lazy(routeImports.Metrics);
const Crm = lazy(routeImports.Crm);
const CallsHistory = lazy(routeImports.Calls);
const SalesAI = lazy(routeImports.SalesAI);
const AiAgents = lazy(routeImports.AiAgents);
const Broadcasts = lazy(routeImports.Broadcasts);
const BroadcastDetail = lazy(routeImports.BroadcastDetail);
const Leadgen = lazy(routeImports.Leadgen);
const Analytics = lazy(routeImports.Analytics);
const CreativeFunnel = lazy(routeImports.CreativeFunnel);
const ContentAnalytics = lazy(routeImports.ContentAnalytics);
const ContentCenter = lazy(routeImports.ContentCenter);
const ContentPlan = lazy(routeImports.ContentPlan);
const ContentPlanDetail = lazy(routeImports.ContentPlanDetail);
const Radar = lazy(routeImports.Radar);
const Publishing = lazy(routeImports.Publishing);
const Legal = lazy(routeImports.Legal);
const Finance = lazy(routeImports.Finance);
const Reports = lazy(routeImports.Reports);
const Settings = lazy(routeImports.Settings);
const SettingsConnection = lazy(routeImports.SettingsConnection);
const ResetPassword = lazy(routeImports.ResetPassword);
const ProjectStrategy = lazy(routeImports.ProjectStrategy);
const ClientDashboard = lazy(routeImports.ClientDashboard);
const ConnectAccount = lazy(routeImports.ConnectAccount);
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
              {/* Подключение аккаунта клиентом по ссылке — публично, без входа в MarkVision. */}
              <Route path="/connect/:token" element={<ConnectAccount />} />
              {/* Публичные юридические страницы — их адреса указываются в кабинетах площадок (TikTok, Meta, Google). */}
              <Route path="/terms" element={<Legal doc="terms" />} />
              <Route path="/privacy" element={<Legal doc="privacy" />} />
              <Route path="/" element={<RequireAuth><AppLayout><RequireModule module="factory"><Index /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/dashboard" element={<RequireAuth><AppLayout><RequireModule module="dashboard"><Dashboard /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/metrics" element={<RequireAuth><AppLayout><RequireModule module="metrics"><Metrics /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/ads" element={<RequireAuth><AppLayout><RequireModule module="ads"><Ads /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/crm" element={<RequireAuth><AppLayout><RequireModule module="crm"><Crm /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/calls" element={<RequireAuth><AppLayout><RequireModule module="crm"><CallsHistory /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/sales-ai" element={<RequireAuth><AppLayout><RequireModule module="sales_ai"><SalesAI /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/ai-agents" element={<RequireAuth><AppLayout><RequireModule module="ai_agents"><AiAgents /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/broadcasts" element={<RequireAuth><AppLayout><RequireModule module="broadcasts"><Broadcasts /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/leadgen" element={<RequireAuth><AppLayout><RequireModule module="leadgen"><Leadgen /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/broadcasts/:id" element={<RequireAuth><AppLayout><RequireModule module="broadcasts"><BroadcastDetail /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/analytics" element={<RequireAuth><AppLayout><RequireModule module="analytics"><Analytics /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/analytics/creatives" element={<RequireAuth><AppLayout><RequireModule module="creative_funnel"><CreativeFunnel /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/analytics/content" element={<RequireAuth><AppLayout><RequireModule module="content_analytics"><ContentAnalytics /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/marketing/content-center" element={<RequireAuth><AppLayout><RequireModule module="content_center"><ContentCenter /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/marketing/content-plan" element={<RequireAuth><AppLayout><RequireModule module="content_plan"><ContentPlan /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/marketing/content-plan/:id" element={<RequireAuth><AppLayout><RequireModule module="content_plan"><ContentPlanDetail /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/marketing/radar" element={<RequireAuth><AppLayout><RequireModule module="content_plan"><Radar /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/marketing/publishing" element={<RequireAuth><AppLayout><RequireModule module="content_plan"><Publishing /></RequireModule></AppLayout></RequireAuth>} />
              {/* Раздел TikTok переехал в Настройки → Подключения; старую ссылку (в TikTok for Developers, документах) держим. */}
              <Route path="/marketing/tiktok" element={<RequireAuth><Navigate to="/settings?tab=tiktok" replace /></RequireAuth>} />
              <Route path="/marketing/autopost" element={<RequireAuth><Navigate to="/marketing/content-plan?view=calendar" replace /></RequireAuth>} />
              <Route path="/finance" element={<RequireAuth><AppLayout><RequireModule module="finance"><Finance /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/reports" element={<RequireAuth><AppLayout><RequireModule module="reports"><Reports /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth><AppLayout><RequireModule module="settings"><Settings /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/settings/connection" element={<RequireAuth><AppLayout><RequireModule module="settings"><SettingsConnection /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/create/step-1" element={<RequireAuth><AppLayout><RequireModule module="factory"><CreateStep1 /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/create/step-2" element={<RequireAuth><AppLayout><RequireModule module="factory"><CreateStep2 /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/create/step-3" element={<RequireAuth><AppLayout><RequireModule module="factory"><CreateStep3 /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/create/neuro-photo" element={<RequireAuth><AppLayout><RequireModule module="factory"><CreateNeuroPhoto /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/create/montage" element={<RequireAuth><AppLayout><RequireModule module="factory"><CreateMontage /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/create/montage-lab" element={<RequireAuth><AppLayout><RequireModule module="factory"><CreateMontageLab /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/create/reels" element={<RequireAuth><AppLayout><RequireModule module="factory"><CreateReels /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/projects/new" element={<RequireAuth><AppLayout><RequireModule module="settings"><ProjectIntegrationWizard /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="/projects/:id/strategy" element={<RequireAuth><AppLayout><RequireModule module="strategy"><ProjectStrategy /></RequireModule></AppLayout></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
