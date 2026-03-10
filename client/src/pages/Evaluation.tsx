import { useLocation } from "wouter";
import { MOCK_STATIONS } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Printer, ArrowLeft, CheckCircle2, XCircle, AlertTriangle, TrendingUp } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export default function Evaluation() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const stationId = searchParams.get('station') || "rescos-001";
  const station = MOCK_STATIONS.find(s => s.id === stationId);

  if (!station) return <div>Station not found</div>;

  const handlePrint = () => {
    window.print();
  };

  // Mock evaluation data
  const score = 82;
  const sections = [
    { name: "Anamnèse", score: 90 },
    { name: "Examen Clinique", score: 75 },
    { name: "Communication", score: 95 },
    { name: "Diagnostic & Prise en charge", score: 70 },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto animate-in fade-in duration-500 pb-24">
      <div className="flex justify-between items-center mb-8 no-print">
        <Button variant="ghost" onClick={() => setLocation("/")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5 mr-2" /> Retour à la bibliothèque
        </Button>
        <Button onClick={handlePrint} className="shadow-sm">
          <Printer className="w-5 h-5 mr-2" /> Exporter en PDF
        </Button>
      </div>

      <div className="print-only mb-8 text-center hidden">
        <h1 className="text-3xl font-bold">Rapport d'Évaluation ECOS</h1>
        <p className="text-muted-foreground mt-2">Station: {station.title} ({station.source})</p>
        <Separator className="mt-4" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="md:col-span-2 border-border shadow-sm">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-xl">Performance Globale</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div className="flex-shrink-0 relative flex items-center justify-center w-32 h-32 rounded-full bg-primary/5 border-[8px] border-primary/20">
                <span className="text-4xl font-bold text-primary">{score}%</span>
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="8" className="text-primary" strokeDasharray="289" strokeDashoffset={289 - (289 * score) / 100} />
                </svg>
              </div>
              <div className="flex-1 space-y-4">
                {sections.map(s => (
                  <div key={s.name}>
                    <div className="flex justify-between text-sm mb-1 font-medium">
                      <span>{s.name}</span>
                      <span className="text-muted-foreground">{s.score}%</span>
                    </div>
                    <Progress value={s.score} className="h-2" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm bg-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-primary">
              <TrendingUp className="w-5 h-5 mr-2" /> Résultat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold mb-2">Réussi</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              L'étudiant a démontré une approche systématique solide. La communication était empathique et rassurante. Des lacunes mineures sur l'examen clinique spécifique.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-green-700">
              <CheckCircle2 className="w-5 h-5 mr-2" /> Points Forts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-start">
                <span className="text-green-500 mr-2 mt-0.5">•</span>
                <span className="text-green-900/80">Excellente introduction et mise en confiance du patient.</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2 mt-0.5">•</span>
                <span className="text-green-900/80">Questionnement systématique sur le symptôme principal (SOCRATES).</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2 mt-0.5">•</span>
                <span className="text-green-900/80">Vérification adéquate des antécédents médicaux.</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-red-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-red-700">
              <XCircle className="w-5 h-5 mr-2" /> Omissions Critiques
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-start">
                <span className="text-red-500 mr-2 mt-0.5">•</span>
                <span className="text-red-900/80 font-medium">N'a pas demandé les allergies médicamenteuses.</span>
              </li>
              <li className="flex items-start">
                <span className="text-red-500 mr-2 mt-0.5">•</span>
                <span className="text-red-900/80">A oublié de palper les pouls périphériques.</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-amber-200 bg-amber-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-amber-700">
              <AlertTriangle className="w-5 h-5 mr-2" /> Priorités d'Amélioration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-start">
                <span className="text-amber-500 mr-2 mt-0.5">•</span>
                <span className="text-amber-900/80">Toujours vérifier les allergies avant de proposer un traitement potentiel, même lors de l'anamnèse initiale.</span>
              </li>
              <li className="flex items-start">
                <span className="text-amber-500 mr-2 mt-0.5">•</span>
                <span className="text-amber-900/80">Structurer davantage l'examen physique cardiovasculaire (Inspection, Palpation, Auscultation).</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}