import { Link, useLocation } from "wouter";
import {
  ChartLine,
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
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function Sidebar() {
  const [location] = useLocation();
  const { user, logout, hasRole } = useAuth();

  const navigationItems = [
    { id: "prompt-generator", label: "Prompt Generator", icon: Zap, path: "/prompt-generator" },
    { id: "dashboard", label: "Dashboard", icon: Home, path: "/" },
    { id: "prompt-results", label: "Prompt Results", icon: MessageSquare, path: "/prompt-results" },
    { id: "competitors", label: "Competitors", icon: Users, path: "/competitors" },
    { id: "compare", label: "Compare", icon: Scale, path: "/compare" },
    { id: "sources", label: "Sources", icon: ExternalLink, path: "/sources" },
    { id: "analysis", label: "Analysis Progress", icon: Activity, path: "/analysis-progress" },
    { id: "settings", label: "Settings", icon: Settings, path: "/settings" },
    ...(hasRole('admin') ? [{ id: 'users', label: 'Users', icon: Shield, path: '/users' }] : []),
  ];

  return (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
      {/* Logo & Title */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <ChartLine className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Brand Tracker</h1>
            <p className="text-xs text-slate-500">Brand Analytics</p>
          </div>
        </div>
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

      {/* User Profile */}
      <div className="p-4 border-t border-slate-200">
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
