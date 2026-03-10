import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Server, Key, Bot } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { toast } = useToast();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Paramètres sauvegardés",
      description: "Les clés d'API et la configuration ont été mises à jour.",
    });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto animate-in fade-in duration-500">
      <header className="mb-10">
        <h1 className="text-4xl font-bold text-foreground mb-2 tracking-tight">Paramètres</h1>
        <p className="text-xl text-muted-foreground">Configurez les fournisseurs d'IA et l'accès aux données.</p>
      </header>

      <form onSubmit={handleSave} className="space-y-8">
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center text-xl">
              <Bot className="w-5 h-5 mr-2 text-primary" /> Modèles Vocaux (Patient IA)
            </CardTitle>
            <CardDescription>Configuration du service Speech-to-Text et Text-to-Speech</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openai-key">Clé API OpenAI (Whisper & TTS)</Label>
              <Input id="openai-key" type="password" placeholder="sk-..." className="font-mono" defaultValue="sk-mock-key-for-prototype" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-model">Modèle de Voix par Défaut</Label>
              <select id="voice-model" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                <option>Alloy (Masculin, Neutre)</option>
                <option>Nova (Féminin, Chaleureux)</option>
                <option>Onyx (Masculin, Grave)</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center text-xl">
              <Server className="w-5 h-5 mr-2 text-primary" /> Évaluateur (Examinateur IA)
            </CardTitle>
            <CardDescription>Modèle d'analyse LLM pour la génération des rapports</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="anthropic-key">Clé API Anthropic (Claude 3.5 Sonnet)</Label>
              <Input id="anthropic-key" type="password" placeholder="sk-ant-..." className="font-mono" defaultValue="sk-ant-mock-key-for-prototype" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rubric-endpoint">Endpoint Custom (Grilles d'évaluation institutionnelles)</Label>
              <Input id="rubric-endpoint" type="url" placeholder="https://api.institution.ch/rubrics" className="font-mono" />
              <p className="text-xs text-muted-foreground">Optionnel : Laissez vide pour utiliser les grilles internes générées par l'IA.</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" size="lg" className="px-8 shadow-md">
            <Save className="w-5 h-5 mr-2" /> Enregistrer la configuration
          </Button>
        </div>
      </form>
    </div>
  );
}