import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Ban, X, Plus } from "lucide-react";

export function UrlBlacklistCard() {
  const { toast } = useToast();
  const [newDomain, setNewDomain] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, refetch } = useQuery<{ domains: string[] }>({
    queryKey: ['/api/settings/source-blacklist'],
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
      const res = await fetch('/api/settings/source-blacklist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: "URL blacklist updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save URL blacklist", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ban className="h-5 w-5" />
          URL Blacklist
        </CardTitle>
        <p className="text-sm text-gray-600">
          Domains that are never recognized as sources. Use this for citation noise that LLMs occasionally surface but isn't a real reference (e.g. <code className="text-xs">myactivity.google.com</code>). Matches are exact on the domain — subdomains aren't auto-included.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {domains.length === 0 ? (
            <span className="text-sm text-gray-500">No domains blacklisted.</span>
          ) : domains.map(domain => (
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
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Add domain (e.g. myactivity.google.com)"
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
