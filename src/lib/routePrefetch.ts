export const routeImports = {
  AppLayout: () => import("@/components/layout/AppLayout"),
  NotFound: () => import("@/pages/NotFound"),
  Index: () => import("@/pages/Index"),
  Login: () => import("@/pages/Login"),
  Lab: () => import("@/pages/Lab"),
  ResetPassword: () => import("@/pages/ResetPassword"),
  CreateStep1: () => import("@/pages/CreateStep1"),
  CreateStep2: () => import("@/pages/CreateStep2"),
  CreateStep3: () => import("@/pages/CreateStep3"),
  CreateNeuroPhoto: () => import("@/pages/CreateNeuroPhoto"),
  CreateMontage: () => import("@/pages/CreateMontage"),
  CreateReels: () => import("@/pages/CreateReels"),
  Ads: () => import("@/pages/Ads"),
  Dashboard: () => import("@/pages/Dashboard"),
  Metrics: () => import("@/pages/Metrics"),
  Crm: () => import("@/pages/Crm"),
  Calls: () => import("@/pages/Calls"),
  SalesAI: () => import("@/pages/SalesAI"),
  AiAgents: () => import("@/pages/AiAgents"),
  Broadcasts: () => import("@/pages/Broadcasts"),
  Analytics: () => import("@/pages/Analytics"),
  CreativeFunnel: () => import("@/pages/CreativeFunnel"),
  ContentAnalytics: () => import("@/pages/ContentAnalytics"),
  ContentCenter: () => import("@/pages/ContentCenter"),
  AutoPost: () => import("@/pages/AutoPost"),
  Finance: () => import("@/pages/Finance"),
  Reports: () => import("@/pages/Reports"),
  Settings: () => import("@/pages/Settings"),
  SettingsConnection: () => import("@/pages/SettingsConnection"),
  ProjectStrategy: () => import("@/pages/ProjectStrategy"),
  ClientDashboard: () => import("@/pages/ClientDashboard"),
  ProjectIntegrationWizard: () => import("@/pages/ProjectIntegrationWizard"),
};

const prefetched = new Set<string>();

export function prefetchRoute(path: string) {
  const key = path.startsWith("/projects/") && path.endsWith("/strategy")
    ? "/projects/:id/strategy"
    : path;

  const loaders: Array<() => Promise<unknown>> = [routeImports.AppLayout];

  switch (key) {
    case "/":
      loaders.push(routeImports.Index);
      break;
    case "/dashboard":
      loaders.push(routeImports.Dashboard);
      break;
    case "/metrics":
      loaders.push(routeImports.Metrics);
      break;
    case "/ads":
      loaders.push(routeImports.Ads);
      break;
    case "/crm":
      loaders.push(routeImports.Crm);
      break;
    case "/ai-agents":
      loaders.push(routeImports.AiAgents);
      break;
    case "/broadcasts":
      loaders.push(routeImports.Broadcasts);
      break;
    case "/calls":
      loaders.push(routeImports.Calls);
      break;
    case "/analytics":
      loaders.push(routeImports.Analytics);
      break;
    case "/analytics/content":
      loaders.push(routeImports.ContentAnalytics);
      break;
    case "/marketing/content-center":
      loaders.push(routeImports.ContentCenter);
      break;
    case "/analytics/creatives":
      loaders.push(routeImports.CreativeFunnel);
      break;
    case "/finance":
      loaders.push(routeImports.Finance);
      break;
    case "/reports":
      loaders.push(routeImports.Reports);
      break;
    case "/settings":
      loaders.push(routeImports.Settings);
      break;
    case "/settings/connection":
      loaders.push(routeImports.SettingsConnection);
      break;
    case "/create/step-1":
      loaders.push(routeImports.CreateStep1);
      break;
    case "/create/step-2":
      loaders.push(routeImports.CreateStep2);
      break;
    case "/create/step-3":
      loaders.push(routeImports.CreateStep3);
      break;
    case "/create/neuro-photo":
      loaders.push(routeImports.CreateNeuroPhoto);
      break;
    case "/projects/:id/strategy":
      loaders.push(routeImports.ProjectStrategy);
      break;
    default:
      return;
  }

  if (prefetched.has(key)) return;
  prefetched.add(key);
  loaders.forEach((load) => {
    load().catch(() => prefetched.delete(key));
  });
}
