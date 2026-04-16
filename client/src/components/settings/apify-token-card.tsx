import { useState, forwardRef, useImperativeHandle } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle } from "lucide-react";

export interface ApifyTokenCardRef {
  savePending: () => Promise<void>;
}

export const ApifyTokenCard = forwardRef<ApifyTokenCardRef>(function ApifyTokenCard(_props, ref) {
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { data: tokenStatus, refetch: refetchToken } = useQuery<{ hasToken: boolean }>({
    queryKey: ['/api/settings/apify-token'],
  });

  const { data: browserStatus } = useQuery<{ mode: string; hasApifyToken: boolean; localContainerUp: boolean }>({
    queryKey: ['/api/settings/browser-status'],
    refetchInterval: 10000,
  });

  useImperativeHandle(ref, () => ({
    savePending: async () => {
      if (token.trim()) await handleSave();
    },
  }));

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/apify-token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast({ title: "Saved", description: token.trim() ? "Apify token saved and validated" : "Apify token removed" });
      setToken("");
      refetchToken();
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveToken = async () => {
    setIsSaving(true);
    try {
      await fetch('/api/settings/apify-token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '' }),
      });
      toast({ title: "Removed", description: "Switched to local mode" });
      refetchToken();
    } catch {
      toast({ title: "Error", description: "Failed to remove token", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const { refetch: refetchStatus } = useQuery<any>({
    queryKey: ['/api/settings/browser-status'],
  });

  const switchMode = async (newMode: 'local' | 'cloud') => {
    try {
      await fetch('/api/settings/browser-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      refetchStatus();
      toast({ title: "Switched", description: `Browser mode set to ${newMode}` });
    } catch {
      toast({ title: "Error", description: "Failed to switch mode", variant: "destructive" });
    }
  };

  const mode = browserStatus?.mode || 'none';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Browser Analysis Mode
          {mode === 'cloud' && (
            <Badge className="bg-green-100 text-green-800 border-green-200">
              <CheckCircle className="h-3 w-3 mr-1" /> Cloud
            </Badge>
          )}
          {mode === 'local' && (
            <Badge className="bg-blue-100 text-blue-800 border-blue-200">
              <CheckCircle className="h-3 w-3 mr-1" /> Local
            </Badge>
          )}
          {mode === 'none' && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              <XCircle className="h-3 w-3 mr-1" /> Not Available
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-gray-600">
          Browser models (Perplexity, ChatGPT, Gemini) need a browser runtime to fetch responses.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Local option */}
          <div
            onClick={() => browserStatus?.localContainerUp && switchMode('local')}
            className={`p-4 rounded-lg border-2 transition-colors ${mode === 'local' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'} ${browserStatus?.localContainerUp ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">Local Container</span>
              {mode === 'local' && <Badge className="bg-blue-100 text-blue-700 text-xs">Active</Badge>}
            </div>
            <div className="text-xs text-gray-500 mb-2 space-y-0.5">
              <div>Cost: <span className="font-medium text-green-700">Free</span></div>
              <div>Speed: <span className="font-medium">~1 prompt/min</span></div>
              <div className="text-gray-400">May get blocked by anti-bot protections</div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {browserStatus?.localContainerUp ? (
                <Badge className="bg-green-100 text-green-700"><CheckCircle className="h-3 w-3 mr-1" /> Running</Badge>
              ) : (
                <Badge variant="outline" className="text-gray-500"><XCircle className="h-3 w-3 mr-1" /> Not running</Badge>
              )}
            </div>
            {!browserStatus?.localContainerUp && (
              <p className="text-xs text-gray-400 mt-2">
                Start with: <code className="bg-gray-100 px-1 rounded">docker compose up -d</code>
              </p>
            )}
          </div>

          {/* Cloud option */}
          <div
            onClick={() => tokenStatus?.hasToken && switchMode('cloud')}
            className={`p-4 rounded-lg border-2 transition-colors ${mode === 'cloud' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'} ${tokenStatus?.hasToken ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">Apify Cloud</span>
              {mode === 'cloud' && <Badge className="bg-green-100 text-green-700 text-xs">Active</Badge>}
            </div>
            <div className="text-xs text-gray-500 mb-2 space-y-0.5">
              <div>Cost: <span className="font-medium text-amber-700">~$0.05/prompt</span></div>
              <div>Speed: <span className="font-medium">~15 prompts/min</span></div>
              <div className="text-gray-400">Residential proxies, no anti-bot issues</div>
            </div>
            {tokenStatus?.hasToken ? (
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-700"><CheckCircle className="h-3 w-3 mr-1" /> Connected</Badge>
                <button onClick={handleRemoveToken} className="text-xs text-red-500 hover:text-red-700 underline" disabled={isSaving}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2 mt-2">
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="apify_api_..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="flex-1 h-8 text-sm"
                  />
                  <Button size="sm" onClick={handleSave} disabled={isSaving || !token.trim()}>
                    {isSaving ? '...' : 'Connect'}
                  </Button>
                </div>
                <p className="text-xs text-gray-400">
                  Get token at{' '}
                  <a href="https://apify.com/?fpr=1lkb9a" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    apify.com
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">We receive a small commission if you use Apify Cloud.</p>
      </CardContent>
    </Card>
  );
});
