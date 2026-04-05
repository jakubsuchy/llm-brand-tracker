import { ReactNode } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import PromptGeneratorPage from "@/pages/prompt-generator";
import PromptResultsPage from "@/pages/prompts";
import CompetitorsPage from "@/pages/competitors";
import ComparePage from "@/pages/compare";
import SourcesPage from "@/pages/sources";
import SettingsPage from "@/pages/settings";
import AnalysisProgressPage from "@/pages/analysis-progress";
import LoginPage from "@/pages/login";
import InitializePage from "@/pages/initialize";
import UsersPage from "@/pages/users";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  if (isLoading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!isAuthenticated) return <Redirect to={`/login?redirect=${encodeURIComponent(location)}`} />;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/initialize" component={InitializePage} />
      <Route>
        <ProtectedRoute>
          <Layout>
            <Switch>
              <Route path="/prompt-generator" component={PromptGeneratorPage} />
              <Route path="/" component={Dashboard} />
              <Route path="/prompt-results" component={PromptResultsPage} />
              <Route path="/competitors" component={CompetitorsPage} />
              <Route path="/compare" component={ComparePage} />
              <Route path="/sources" component={SourcesPage} />
              <Route path="/analysis-progress" component={AnalysisProgressPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/users" component={UsersPage} />
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
