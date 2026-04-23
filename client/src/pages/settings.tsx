import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Settings } from "lucide-react";

import { AnalysisLlmCard } from "@/components/settings/analysis-llm-card";
import { ModelsCard } from "@/components/settings/models-card";
import { BrandDetailsCard } from "@/components/settings/brand-details-card";
import { AnalysisScheduleCard } from "@/components/settings/analysis-schedule-card";
import { ApifyTokenCard, type ApifyTokenCardRef } from "@/components/settings/apify-token-card";
import { BrandDomainsCard } from "@/components/settings/brand-domains-card";
import { CompetitorSubdomainsCard } from "@/components/settings/competitor-subdomains-card";
import { CompetitorExclusionsCard } from "@/components/settings/competitor-exclusions-card";
import { DangerZoneCard } from "@/components/settings/danger-zone-card";
import { WebhookCard } from "@/components/settings/webhook-card";
import { IntegrationsFlowDiagram } from "@/components/integrations-flow-diagram";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Code, ExternalLink } from "lucide-react";

const SETTINGS_TABS = ['brand', 'credentials', 'models', 'sources', 'integrations', 'danger'] as const;
const WIZARD_TABS = ['brand', 'credentials', 'models'] as const;

export default function SettingsPage({ wizardMode = false }: { wizardMode?: boolean }) {
  const [, setLocation] = useLocation();
  const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
  const initialTab = SETTINGS_TABS.includes(hash as any) ? hash : 'brand';
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const onHashChange = () => {
      const h = window.location.hash.slice(1);
      if (SETTINGS_TABS.includes(h as any)) setActiveTab(h);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  const apifyRef = useRef<ApifyTokenCardRef>(null);
  const { toast } = useToast();

  const { data: openaiStatus } = useQuery<{ hasKey: boolean }>({
    queryKey: ['/api/settings/openai-key'],
  });
  const { data: anthropicStatus } = useQuery<{ hasKey: boolean }>({
    queryKey: ['/api/settings/anthropic-key'],
  });
  const hasAnyLlmKey = openaiStatus?.hasKey || anthropicStatus?.hasKey || false;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">{wizardMode ? 'Setup' : 'Settings'}</h1>
          <p className="text-gray-600">{wizardMode ? 'Configure your brand tracker to get started' : 'Configure your brand tracker'}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="max-w-2xl">
        <TabsList className="mb-6 h-auto flex-wrap gap-1">
          {wizardMode ? (
            <>
              <TabsTrigger value="brand">1. Brand</TabsTrigger>
              <TabsTrigger value="credentials">2. Credentials</TabsTrigger>
              <TabsTrigger value="models">3. Models</TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="brand">Brand</TabsTrigger>
              <TabsTrigger value="credentials">Credentials</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="sources">Sources</TabsTrigger>
              <TabsTrigger value="integrations">Integrations</TabsTrigger>
              <TabsTrigger value="danger">Danger</TabsTrigger>
            </>
          )}</TabsList>

        <TabsContent value="brand" className="space-y-6">
          <BrandDetailsCard wizardMode={wizardMode} onContinue={() => handleTabChange('credentials')} />
          {!wizardMode && <AnalysisScheduleCard />}
        </TabsContent>

        <TabsContent value="credentials" className="space-y-6">
          <AnalysisLlmCard />
          <ApifyTokenCard ref={apifyRef} />
          {wizardMode && (
            <Button onClick={async () => {
              if (!hasAnyLlmKey) {
                toast({ title: "API Key required", description: "Please configure at least one analysis LLM key (OpenAI or Anthropic)", variant: "destructive" });
                return;
              }
              await apifyRef.current?.savePending();
              handleTabChange('models');
            }} className="w-full">
              Continue to Models →
            </Button>
          )}
        </TabsContent>

        <TabsContent value="models" className="space-y-6">
          <ModelsCard wizardMode={wizardMode} />
          {wizardMode && (
            <Button onClick={() => setLocation('/prompt-generator')} className="w-full">
              Continue to Prompt Generator →
            </Button>
          )}
        </TabsContent>

        {!wizardMode && (
          <TabsContent value="sources" className="space-y-6">
            <BrandDomainsCard />
            <CompetitorSubdomainsCard />
            <CompetitorExclusionsCard />
          </TabsContent>
        )}

        {!wizardMode && (
          <TabsContent value="integrations" className="space-y-6">
            <IntegrationsFlowDiagram className="w-full rounded-xl border" />

            <WebhookCard />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Code className="h-5 w-5" />
                  REST API
                </CardTitle>
                <p className="text-sm text-gray-600">
                  Access all your brand tracking data programmatically. Fetch analysis runs, responses, competitors, sources, and metrics. Build custom dashboards or feed data into your own analytics pipeline.
                </p>
              </CardHeader>
              <CardContent>
                <a
                  href="/api/docs"
                  target="_blank"
                  className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Open API Documentation
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.5 12a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 2v4m0 12v4M2 12h4m12 0h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  n8n
                </CardTitle>
                <p className="text-sm text-gray-600">
                  Use the TraceAIO community node in n8n to integrate brand tracking data into your automation workflows. Trigger actions on analysis completion, sync results to spreadsheets, send reports via email, and more.
                </p>
              </CardHeader>
              <CardContent>
                <a
                  href="https://www.n8n.io/integrations/traceaio"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Install TraceAIO node on n8n.io
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {!wizardMode && (
          <TabsContent value="danger" className="space-y-6">
            <DangerZoneCard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
