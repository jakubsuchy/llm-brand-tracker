import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Globe, CheckCircle, Save } from "lucide-react";

export function BrandDetailsCard({ wizardMode, onContinue }: { wizardMode?: boolean; onContinue?: () => void }) {
  const [brandUrl, setBrandUrl] = useState('');
  const [brandName, setBrandName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { data, refetch } = useQuery<{ brandUrl: string | null; brandName: string | null }>({
    queryKey: ['/api/settings/brand'],
  });

  // Populate fields from DB on load
  useState(() => {
    if (data) {
      if (data.brandUrl && !brandUrl) setBrandUrl(data.brandUrl);
      if (data.brandName && !brandName) setBrandName(data.brandName);
    }
  });

  // Update fields when data loads
  const displayUrl = brandUrl || data?.brandUrl || '';
  const displayName = brandName || data?.brandName || '';

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandUrl: brandUrl || data?.brandUrl || '',
          brandName: brandName || data?.brandName || '',
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: "Brand details updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save brand details", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Brand Details
          {data?.brandName && (
            <Badge className="bg-green-100 text-green-800 border-green-200">
              <CheckCircle className="h-3 w-3 mr-1" />
              {data.brandName}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-gray-600">
          Your brand identity used for analysis. The Prompt Generator reads these values.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="brandUrl">Brand Website URL</Label>
          <Input
            id="brandUrl"
            type="url"
            placeholder="https://example.com"
            value={brandUrl || data?.brandUrl || ''}
            onChange={(e) => setBrandUrl(e.target.value)}
          />
          <p className="text-xs text-gray-500">Used to scrape brand content and generate relevant analysis topics</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="brandName">Brand Name</Label>
          <Input
            id="brandName"
            placeholder="My Brand"
            value={brandName || data?.brandName || ''}
            onChange={(e) => setBrandName(e.target.value)}
          />
          <p className="text-xs text-gray-500">Used to detect brand mentions in LLM responses</p>
        </div>
        <Button onClick={async () => { await handleSave(); if (wizardMode && onContinue) onContinue(); }} disabled={isSaving} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : wizardMode ? 'Save and continue to Credentials →' : 'Save Brand Details'}
        </Button>
      </CardContent>
    </Card>
  );
}
