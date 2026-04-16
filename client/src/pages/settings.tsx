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
import { CompetitorSubdomainsCard } from "@/components/settings/competitor-subdomains-card";
import { CompetitorExclusionsCard } from "@/components/settings/competitor-exclusions-card";
import { DangerZoneCard } from "@/components/settings/danger-zone-card";

const SETTINGS_TABS = ['brand', 'credentials', 'models', 'sources', 'danger'] as const;
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
          <ModelsCard />
          {wizardMode && (
            <Button onClick={() => setLocation('/prompt-generator')} className="w-full">
              Continue to Prompt Generator →
            </Button>
          )}
        </TabsContent>

        {!wizardMode && (
          <TabsContent value="sources" className="space-y-6">
            <CompetitorSubdomainsCard />
            <CompetitorExclusionsCard />
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
