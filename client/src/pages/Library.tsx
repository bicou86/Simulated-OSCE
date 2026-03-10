import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MOCK_STATIONS } from "@/lib/mockData";
import { Play, Clock, Activity, FileText } from "lucide-react";
import { useLocation } from "wouter";

export default function Library() {
  const [, setLocation] = useLocation();

  const handleStart = (id: string) => {
    setLocation(`/simulation?station=${id}`);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-10">
        <h1 className="text-4xl font-bold text-foreground mb-2 tracking-tight">Bibliothèque de Stations</h1>
        <p className="text-xl text-muted-foreground">Sélectionnez un cas clinique pour débuter l'OSCE.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {MOCK_STATIONS.map((station) => (
          <Card key={station.id} className="group hover:shadow-lg hover:border-primary/30 transition-all duration-300 flex flex-col bg-card">
            <CardHeader className="pb-4">
              <div className="flex justify-between items-start mb-2">
                <Badge variant={
                  station.source === 'RESCOS' ? 'default' : 
                  station.source === 'AMBOSS' ? 'secondary' : 'outline'
                } className="px-3 py-1 text-sm font-medium">
                  {station.source}
                </Badge>
                <div className="flex items-center text-muted-foreground text-sm font-medium bg-muted/50 px-2 py-1 rounded-md">
                  <Clock className="w-4 h-4 mr-1.5" />
                  {station.duration} min
                </div>
              </div>
              <CardTitle className="text-2xl font-bold leading-tight group-hover:text-primary transition-colors">{station.title}</CardTitle>
              <CardDescription className="text-base font-medium text-primary/80 mt-1">{station.specialty}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 text-muted-foreground text-base leading-relaxed">
              <p className="line-clamp-3">{station.scenario}</p>
            </CardContent>
            <CardFooter className="pt-4 border-t border-border/50 bg-muted/20">
              <Button 
                onClick={() => handleStart(station.id)} 
                className="w-full text-lg h-14 rounded-xl shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
                data-testid={`btn-start-${station.id}`}
              >
                <Play className="w-5 h-5 mr-2 fill-current" />
                Lancer la Simulation
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}