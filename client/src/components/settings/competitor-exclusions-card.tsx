import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldX, X, Plus } from "lucide-react";

export function CompetitorExclusionsCard() {
  const { toast } = useToast();
  const [newEntry, setNewEntry] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, refetch } = useQuery<{ entries: string[] }>({
    queryKey: ['/api/settings/competitor-blocklist'],
  });

  const entries = data?.entries || [];

  const addEntry = () => {
    const cleaned = newEntry.trim().toLowerCase();
    if (!cleaned || entries.includes(cleaned)) {
      setNewEntry('');
      return;
    }
    saveEntries([...entries, cleaned]);
    setNewEntry('');
  };

  const removeEntry = (entry: string) => {
    saveEntries(entries.filter(e => e !== entry));
  };

  const saveEntries = async (updated: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/competitor-blocklist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: "Exclusion list updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save exclusion list", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldX className="h-5 w-5" />
          Not Competitors
        </CardTitle>
        <p className="text-sm text-gray-600">
          Names and domains that should never be classified as competitors. These are review sites, social platforms, and other neutral sources that LLMs sometimes mention alongside products. You can also reclassify directly from the Competitors page.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {entries.map(entry => (
            <Badge key={entry} variant="secondary" className="text-sm gap-1 pl-3 pr-1 py-1">
              {entry}
              <button
                onClick={() => removeEntry(entry)}
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
            placeholder="Add name or domain (e.g. wikipedia.org, Forrester)"
            value={newEntry}
            onChange={(e) => setNewEntry(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEntry()}
            className="flex-1"
          />
          <Button variant="outline" onClick={addEntry} disabled={!newEntry.trim() || saving}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
