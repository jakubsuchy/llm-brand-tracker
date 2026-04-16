import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Globe, X, Plus } from "lucide-react";

export function CompetitorSubdomainsCard() {
  const { toast } = useToast();
  const [newPrefix, setNewPrefix] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, refetch } = useQuery<{ prefixes: string[] }>({
    queryKey: ['/api/settings/competitor-subdomains'],
  });

  const prefixes = data?.prefixes || ['docs'];

  const addPrefix = () => {
    const cleaned = newPrefix.trim().toLowerCase();
    if (!cleaned || prefixes.includes(cleaned)) {
      setNewPrefix('');
      return;
    }
    savePrefixes([...prefixes, cleaned]);
    setNewPrefix('');
  };

  const removePrefix = (prefix: string) => {
    savePrefixes(prefixes.filter(p => p !== prefix));
  };

  const savePrefixes = async (updated: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/competitor-subdomains', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: "Subdomain prefixes updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save subdomain settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Competitor Subdomain Recognition
        </CardTitle>
        <p className="text-sm text-gray-600">
          Automatically recognize subdomains as competitor sources. Add a prefix like "docs" to match docs.paypal.com → paypal.com for any competitor, or a full domain like "techdocs.f5.com" to map that specific subdomain to f5.com.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {prefixes.map(prefix => (
            <Badge key={prefix} variant="secondary" className="text-sm gap-1 pl-3 pr-1 py-1">
              {prefix.includes('.') ? prefix : `${prefix}.*`}
              <button
                onClick={() => removePrefix(prefix)}
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
            placeholder="Add prefix (e.g. api, blog) or full domain (e.g. techdocs.f5.com)"
            value={newPrefix}
            onChange={(e) => setNewPrefix(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPrefix()}
            className="flex-1"
          />
          <Button variant="outline" onClick={addPrefix} disabled={!newPrefix.trim() || saving}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          Prefixes: docs, api, blog, support, developer, learn. Full domains: techdocs.f5.com, status.stripe.com
        </p>
      </CardContent>
    </Card>
  );
}
