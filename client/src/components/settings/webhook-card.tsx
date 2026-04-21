import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Webhook, Save, Send } from "lucide-react";

interface WebhookSettings {
  url: string;
  authType: 'none' | 'bearer';
  token: string;
}

export function WebhookCard() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<'none' | 'bearer'>('none');
  const [token, setToken] = useState('');

  const { data } = useQuery<WebhookSettings>({
    queryKey: ['/api/settings/webhook'],
  });

  useEffect(() => {
    if (data) {
      setUrl(data.url || '');
      setAuthType(data.authType || 'none');
      setToken(data.token || '');
    }
  }, [data]);

  const handleSave = async () => {
    if (url && !/^https?:\/\/.+/.test(url)) {
      toast({ title: "Invalid URL", description: "Webhook URL must start with http:// or https://", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/webhook', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, authType, token }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save');
      }
      toast({ title: "Saved", description: "Webhook settings updated" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to save webhook settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-5 w-5" />
          Webhook
        </CardTitle>
        <p className="text-sm text-gray-600">
          Send a POST request to an external URL when an analysis run completes. The payload includes the <code className="text-xs bg-gray-100 px-1 rounded">runId</code>, timestamps, response count, and brand mention statistics. Use the <code className="text-xs bg-gray-100 px-1 rounded">runId</code> to fetch full analysis details via the <a href="/api/docs" target="_blank" className="text-blue-600 hover:underline">API</a>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="webhook-url">Webhook URL</Label>
          <Input
            id="webhook-url"
            placeholder="https://example.com/webhook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Authentication</Label>
          <Select value={authType} onValueChange={(v) => setAuthType(v as 'none' | 'bearer')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="bearer">Authorization Bearer Token</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {authType === 'bearer' && (
          <div className="space-y-2">
            <Label htmlFor="webhook-token">Bearer Token</Label>
            <Input
              id="webhook-token"
              type="password"
              placeholder="Enter token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-xs text-gray-500">
              Sent as <code className="bg-gray-100 px-1 rounded">Authorization: Bearer &lt;token&gt;</code> header
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            <Save className="h-4 w-4 mr-2" />
            Save Webhook Settings
          </Button>
          <Button
            variant="outline"
            disabled={testing || !url}
            onClick={async () => {
              if (!/^https?:\/\/.+/.test(url)) {
                toast({ title: "Invalid URL", description: "Webhook URL must start with http:// or https://", variant: "destructive" });
                return;
              }
              setTesting(true);
              try {
                const res = await fetch('/api/settings/webhook/test', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url, authType, token }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || 'Test failed');
                toast({ title: "Test sent", description: `Webhook responded with ${body.status}` });
              } catch (e: any) {
                toast({ title: "Test failed", description: e.message, variant: "destructive" });
              } finally {
                setTesting(false);
              }
            }}
          >
            <Send className="h-4 w-4 mr-2" />
            {testing ? 'Sending...' : 'Send test event'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
