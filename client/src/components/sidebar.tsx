import { Link, useLocation } from "wouter";
import logoUrl from "@/logo.png";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  MessageSquare,
  Users,
  ExternalLink,
  Settings,
  User,
  Activity,
  Zap,
  Scale,
  Shield,
  LogOut,
  Key,
  Copy,
  Check,
  Download,
  Archive,
  ListChecks,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const McpIcon = () => (
  <svg viewBox="0 0 180 180" className="w-5 h-5" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 84.8528L85.8822 16.9706C95.2548 7.59798 110.451 7.59798 119.823 16.9706C129.196 26.3431 129.196 41.5391 119.823 50.9117L68.5581 102.177" stroke="currentColor" strokeWidth="12" strokeLinecap="round"/>
    <path d="M69.2652 101.47L119.823 50.9117C129.196 41.5391 144.392 41.5391 153.765 50.9117L154.118 51.2652C163.491 60.6378 163.491 75.8338 154.118 85.2063L92.7248 146.6C89.6006 149.724 89.6006 154.789 92.7248 157.913L105.331 170.52" stroke="currentColor" strokeWidth="12" strokeLinecap="round"/>
    <path d="M102.853 33.9411L52.6482 84.1457C43.2756 93.5183 43.2756 108.714 52.6482 118.087C62.0208 127.459 77.2167 127.459 86.5893 118.087L136.794 67.8822" stroke="currentColor" strokeWidth="12" strokeLinecap="round"/>
  </svg>
);

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { user, logout, hasRole } = useAuth();
  const [copied, setCopied] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const { data: brandData } = useQuery<{ brandName: string | null }>({ queryKey: ['/api/settings/brand'] });
  const brandName = brandData?.brandName || 'my brand';
  const suggestedPrompt = `Open this zip file, read through README.md to discover the structure of this data, and let me run an analysis.\n\nMy brand is ${brandName}, what is the top source citing my brand?`;
  const [promptCopied, setPromptCopied] = useState(false);

  const handleRegenerateKey = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/users/${user?.id}/api-key`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setGeneratedKey(data.apiKey);
    } catch {
      // silent
    } finally {
      setRegenerating(false);
    }
  };

  const isAdminOrAnalyst = hasRole('admin') || hasRole('analyst');
  const isAdmin = hasRole('admin');

  const navigationItems = [
    ...(isAdminOrAnalyst ? [{ id: "prompt-generator", label: "Prompt Generator", icon: Zap, path: "/prompt-generator" }] : []),
    { id: "dashboard", label: "Dashboard", icon: Home, path: "/" },
    { id: "prompts", label: "Prompts", icon: ListChecks, path: "/prompts" },
    { id: "responses", label: "Responses", icon: MessageSquare, path: "/responses" },
    { id: "competitors", label: "Competitors", icon: Users, path: "/competitors" },
    { id: "compare", label: "Compare", icon: Scale, path: "/compare" },
    { id: "sources", label: "Sources", icon: ExternalLink, path: "/sources" },
    ...(isAdminOrAnalyst ? [{ id: "analysis", label: "Analysis Progress", icon: Activity, path: "/analysis-progress" }] : []),
    ...(isAdmin ? [{ id: "settings", label: "Settings", icon: Settings, path: "/settings" }] : []),
    ...(isAdmin ? [{ id: 'users', label: 'Users', icon: Shield, path: '/users' }] : []),
  ];

  return (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-200">
        <img src={logoUrl} alt="TraceAIO" className="h-10" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <div className="space-y-2">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;
            
            return (
              <Link
                key={item.id}
                href={item.path}
                onClick={() => onNavigate?.()}
                className={`
                  flex items-center space-x-3 px-3 py-2 rounded-lg w-full text-left transition-colors
                  ${isActive
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-100'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>


      </nav>

      {/* MCP Connect Banner */}
      <div className="px-4 pb-2">
        <Dialog>
          <DialogTrigger asChild>
            <button className="w-full flex items-center gap-2.5 p-2.5 rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 hover:border-indigo-200 transition-colors text-left">
              <McpIcon />
              <div className="min-w-0">
                <p className="text-xs font-medium text-indigo-900">Chat with your data</p>
                <p className="text-[10px] text-indigo-600">with Claude AI</p>
              </div>
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <McpIcon />
                Chat with your data
              </DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="mcp">
              <TabsList className="w-full">
                <TabsTrigger value="mcp" className="flex-1">Claude Code (MCP)</TabsTrigger>
                <TabsTrigger value="export" className="flex-1">Export Data</TabsTrigger>
              </TabsList>

              <TabsContent value="mcp" className="space-y-4 mt-4">
                <p className="text-sm text-gray-600">
                  Query your brand tracking data using natural language in Claude Desktop or Claude Code.
                </p>

                <div className="space-y-2">
                  <Button size="sm" variant="outline" className="w-full text-xs" onClick={handleRegenerateKey} disabled={regenerating}>
                    <Key className="h-3 w-3 mr-1.5" />
                    {regenerating ? 'Generating...' : user?.hasApiKey || generatedKey ? 'Regenerate API Key' : 'Generate API Key'}
                  </Button>
                  {generatedKey && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <code className="text-xs text-gray-800 truncate flex-1 select-all">{generatedKey}</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 shrink-0"
                          onClick={() => { navigator.clipboard.writeText(generatedKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        >
                          {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                      <p className="text-xs text-amber-700">Copy this key now. It won't be shown again.</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-700">Install command (Claude Code):</p>
                  {generatedKey ? (
                    <div className="relative">
                      <pre className="bg-gray-50 border rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">
{`claude mcp add --transport http brand-tracker ${window.location.origin}/mcp --header "Authorization:Bearer ${generatedKey}"`}
                      </pre>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute top-1 right-1 h-7 w-7 p-0"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `claude mcp add --transport http brand-tracker ${window.location.origin}/mcp --header "Authorization:Bearer ${generatedKey}"`
                          );
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <pre className="bg-gray-50 border rounded-lg p-3 text-xs text-gray-400">
                      Click {user?.hasApiKey ? 'Regenerate' : 'Generate'} API Key to see the full command
                    </pre>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-700">Example questions you can ask:</p>
                  <div className="grid gap-1.5">
                    {[
                      "What's my brand mention rate?",
                      "Which model performs best for us?",
                      "Who are our top competitors?",
                      "What prompts don't mention us?",
                      "Which sources cite competitors but not us?",
                    ].map(q => (
                      <div key={q} className="text-xs text-gray-600 bg-gray-50 rounded px-2.5 py-1.5">"{q}"</div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="export" className="space-y-4 mt-4">
                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                  <p className="text-sm text-indigo-900 font-medium mb-1">No access to run MCP?</p>
                  <p className="text-xs text-indigo-700">
                    Export your data in a zip format, and give it to the AI manually. The archive contains a README plus one CSV per key table.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-700">Suggested prompt to paste with your zip:</p>
                  <div className="relative">
                    <pre className="bg-gray-50 border rounded-lg p-3 text-xs whitespace-pre-wrap break-words">{suggestedPrompt}</pre>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute top-1 right-1 h-7 w-7 p-0"
                      onClick={() => {
                        navigator.clipboard.writeText(suggestedPrompt);
                        setPromptCopied(true);
                        setTimeout(() => setPromptCopied(false), 2000);
                      }}
                    >
                      {promptCopied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={() => { window.location.href = '/api/export/bundle'; }}
                >
                  <Archive className="h-4 w-4 mr-1.5" />
                  Export ZIP
                  <Download className="h-4 w-4 ml-1.5" />
                </Button>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      {/* User Profile */}
      <div className="p-4 border-t border-slate-200 space-y-2">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-slate-300 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-slate-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{user?.fullName || 'User'}</p>
            <p className="text-xs text-slate-500 truncate">{user?.roles?.join(', ') || ''}</p>
          </div>
          <button
            onClick={() => logout()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
