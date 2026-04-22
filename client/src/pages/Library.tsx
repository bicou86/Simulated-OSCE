import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Search, Loader2, AlertCircle } from "lucide-react";
import { ApiError, listStations, type StationMeta, type StationSource } from "@/lib/api";
import { availableCanonicalSettings, canonicalSetting } from "@/lib/settingGroups";

const SOURCES: StationSource[] = ["AMBOSS", "German", "RESCOS", "USMLE", "USMLE_Triage"];

const SOURCE_COLOR: Record<StationSource, "default" | "secondary" | "outline"> = {
  RESCOS: "default",
  AMBOSS: "secondary",
  USMLE: "outline",
  USMLE_Triage: "outline",
  German: "outline",
};

export default function Library() {
  const [, setLocation] = useLocation();
  const [stations, setStations] = useState<StationMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<StationSource | "all">("all");
  const [settingFilter, setSettingFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listStations();
        if (cancelled) return;
        setStations(res.stations);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Liste des cadres canoniques présents dans les données, pour alimenter le combobox.
  // Les 64 variantes brutes sont regroupées en ~17 étiquettes sémantiques par
  // lib/settingGroups.ts.
  const settings = useMemo(
    () => availableCanonicalSettings(stations.map((s) => s.setting)),
    [stations],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stations.filter((s) => {
      if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
      if (settingFilter !== "all" && canonicalSetting(s.setting) !== settingFilter) return false;
      if (q && !`${s.id} ${s.title} ${s.setting}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [stations, search, sourceFilter, settingFilter]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 148,
    overscan: 6,
  });

  const handleStart = (id: string) => {
    setLocation(`/simulation?station=${encodeURIComponent(id)}`);
  };

  return (
    <div className="h-full flex flex-col p-8 max-w-7xl mx-auto w-full animate-in fade-in duration-500">
      <header className="mb-6 shrink-0">
        <h1 className="text-4xl font-bold text-foreground mb-2 tracking-tight">Bibliothèque de stations</h1>
        <p className="text-lg text-muted-foreground">
          {loading ? "Chargement…" : `${filtered.length} station${filtered.length > 1 ? "s" : ""} sur ${stations.length} — filtrez par source, cadre ou mot-clé.`}
        </p>
      </header>

      {/* Filtres */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-[1fr_200px_240px] gap-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un ID, un titre, un motif…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11"
            data-testid="input-search"
          />
        </div>
        <select
          className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as StationSource | "all")}
          data-testid="select-source"
        >
          <option value="all">Toutes les sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          value={settingFilter}
          onChange={(e) => setSettingFilter(e.target.value)}
          data-testid="select-setting"
        >
          <option value="all">Tous les cadres</option>
          {settings.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground">
          <Loader2 className="w-6 h-6 mr-2 animate-spin" /> Chargement des 285 stations…
        </div>
      ) : error ? (
        <div className="flex items-center justify-center flex-1 text-red-600">
          <AlertCircle className="w-5 h-5 mr-2" /> {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground">
          Aucune station ne correspond à vos filtres.
        </div>
      ) : (
        <div
          ref={parentRef}
          className="flex-1 overflow-y-auto rounded-lg border border-border/60 bg-card/30"
          data-testid="stations-list"
        >
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const s = filtered[row.index];
              return (
                <div
                  key={s.id}
                  data-testid={`station-card-${s.id}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${row.start}px)`,
                    padding: "6px 10px",
                  }}
                >
                  <Card className="hover:shadow-md hover:border-primary/30 transition-all bg-card">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Badge variant={SOURCE_COLOR[s.source] ?? "outline"} className="font-mono">{s.source}</Badge>
                          <span className="font-mono text-sm text-muted-foreground">{s.id}</span>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleStart(s.id)}
                          data-testid={`btn-start-${s.id}`}
                        >
                          <Play className="w-4 h-4 mr-1 fill-current" /> Lancer
                        </Button>
                      </div>
                      <CardTitle className="text-lg font-semibold leading-tight mt-1">{s.title}</CardTitle>
                      {s.setting && (
                        <CardDescription className="text-sm text-primary/80">
                          {canonicalSetting(s.setting)}
                        </CardDescription>
                      )}
                    </CardHeader>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
