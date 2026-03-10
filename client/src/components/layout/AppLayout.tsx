import { Link, useLocation } from "wouter";
import { Activity, Library, Settings, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", icon: Library, label: "Bibliothèque" },
    { href: "/simulation", icon: Activity, label: "Simulation Active" },
    { href: "/evaluation", icon: FileText, label: "Évaluations" },
    { href: "/settings", icon: Settings, label: "Paramètres" },
  ];

  return (
    <div className="flex h-screen w-screen bg-background overflow-hidden selection:bg-primary/20">
      {/* Sidebar Navigation */}
      <aside className="w-24 md:w-64 bg-card border-r border-border flex flex-col no-print shrink-0">
        <div className="p-4 md:p-6 flex items-center justify-center md:justify-start gap-3 mb-4">
          <div className="bg-primary/10 text-primary p-2 rounded-lg">
            <Activity className="w-6 h-6" />
          </div>
          <span className="font-semibold text-lg hidden md:block text-foreground tracking-tight">OSCE Sim</span>
        </div>
        
        <nav className="flex-1 px-3 space-y-2">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <a className={cn(
                  "flex items-center gap-3 px-3 py-3 md:px-4 md:py-4 rounded-xl transition-all duration-200 group relative",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:scale-95"
                )}>
                  <item.icon className={cn("w-6 h-6 shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                  <span className="font-medium hidden md:block text-base">{item.label}</span>
                  {isActive && (
                    <div className="absolute left-0 w-1.5 h-8 bg-white/20 rounded-r-full" />
                  )}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <div className="flex items-center gap-3 text-sm text-muted-foreground justify-center md:justify-start p-2">
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" />
            <span className="hidden md:block">Système Actif</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-hidden relative bg-background">
        <div className="h-full overflow-y-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}