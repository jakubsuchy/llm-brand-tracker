import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Globe, X, Plus } from "lucide-react";

export function BrandDomainsCard() {
  const { toast } = useToast();
  const [newDomain, setNewDomain] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, refetch } = useQuery<{ domains: string[] }>({
    queryKey: ['/api/settings/brand-domains'],
  });

  const domains = data?.domains || [];

  const addDomain = () => {
    const cleaned = newDomain.trim().toLowerCase();
    if (!cleaned || domains.includes(cleaned)) {
      setNewDomain('');
      return;
    }
    saveDomains([...domains, cleaned]);
    setNewDomain('');
  };

  const removeDomain = (domain: string) => {
    saveDomains(domains.filter(d => d !== domain));
  };

  const saveDomains = async (updated: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/brand-domains', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: "Brand domains updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save brand domains", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Additional Brand Domains
        </CardTitle>
        <p className="text-sm text-gray-600">
          Domains owned by your brand that should be classified as brand sources. Your main brand domain is detected automatically — add any additional domains here (e.g. blog, docs site, product subdomains).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {domains.map(domain => (
            <Badge key={domain} variant="secondary" className="text-sm gap-1 pl-3 pr-1 py-1">
              {domain}
              <button
                onClick={() => removeDomain(domain)}
                className="hover:bg-gray-300 rounded-full p-0.5 ml-1"
                disabled={saving}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {domains.length === 0 && (
            <p className="text-sm text-gray-400">No additional brand domains configured</p>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Add domain (e.g. blog.mybrand.com, mybrand.io)"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDomain()}
            className="flex-1"
          />
          <Button variant="outline" onClick={addDomain} disabled={!newDomain.trim() || saving}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
