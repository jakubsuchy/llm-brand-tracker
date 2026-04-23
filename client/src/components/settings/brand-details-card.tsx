import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Globe, CheckCircle, Save } from "lucide-react";

interface BrandSettings {
  brandUrl: string | null;
  brandName: string | null;
  autoWatchBrandUrls: boolean;
  brandSitemapUrl: string;
}

export function BrandDetailsCard({ wizardMode, onContinue }: { wizardMode?: boolean; onContinue?: () => void }) {
  const [brandUrl, setBrandUrl] = useState('');
  const [brandName, setBrandName] = useState('');
  const [autoWatch, setAutoWatch] = useState(true);
  const [brandSitemapUrl, setBrandSitemapUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { data, refetch } = useQuery<BrandSettings>({
    queryKey: ['/api/settings/brand'],
  });

  useEffect(() => {
    if (!data) return;
    if (data.brandUrl) setBrandUrl(data.brandUrl);
    if (data.brandName) setBrandName(data.brandName);
    setAutoWatch(data.autoWatchBrandUrls);
    setBrandSitemapUrl(data.brandSitemapUrl || '');
  }, [data]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandUrl: brandUrl || data?.brandUrl || '',
          brandName: brandName || data?.brandName || '',
          autoWatchBrandUrls: autoWatch,
          brandSitemapUrl: brandSitemapUrl.trim(),
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
            value={brandUrl}
            onChange={(e) => setBrandUrl(e.target.value)}
          />
          <p className="text-xs text-gray-500">Used to scrape brand content and generate relevant analysis topics</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="brandName">Brand Name</Label>
          <Input
            id="brandName"
            placeholder="My Brand"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
          />
          <p className="text-xs text-gray-500">Used to detect brand mentions in LLM responses</p>
        </div>

        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="autoWatchBrandUrls"
              checked={autoWatch}
              onCheckedChange={(v) => setAutoWatch(v === true)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <Label htmlFor="autoWatchBrandUrls" className="font-medium cursor-pointer">
                Automatically watch all brand URLs
              </Label>
              <p className="text-xs text-gray-600 mt-1">
                Before each analysis, fetch your <code className="text-[11px] bg-white px-1 py-0.5 rounded">sitemap.xml</code> and add every URL to the Source Watchlist. You'll get alerts when an LLM cites any of them — useful for tracking new blog posts or landing pages. Query strings are ignored when matching.
              </p>
            </div>
          </div>

          {autoWatch && (
            <div className="pl-6 space-y-1">
              <Label htmlFor="brandSitemapUrl" className="text-xs font-normal text-gray-600">
                Custom sitemap URL (optional)
              </Label>
              <Input
                id="brandSitemapUrl"
                type="url"
                placeholder="Leave empty to use <brand>/sitemap.xml"
                value={brandSitemapUrl}
                onChange={(e) => setBrandSitemapUrl(e.target.value)}
                className="bg-white text-sm"
              />
            </div>
          )}
        </div>

        <Button onClick={async () => { await handleSave(); if (wizardMode && onContinue) onContinue(); }} disabled={isSaving} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : wizardMode ? 'Save and continue to Credentials →' : 'Save Brand Details'}
        </Button>
      </CardContent>
    </Card>
  );
}
