import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, Server, Bot, CheckCircle2, XCircle, Loader2, PlugZap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ApiError, getSettingsStatus, saveSettings, type SettingsStatus, type TtsVoice } from "@/lib/api";
import { getPreferredVoice, setPreferredVoice } from "@/lib/preferences";

const VOICES: Array<{ value: TtsVoice; label: string }> = [
  { value: "alloy", label: "Alloy (neutre)" },
  { value: "echo", label: "Echo (masculin posé)" },
  { value: "fable", label: "Fable (masculin narratif)" },
  { value: "nova", label: "Nova (féminin chaleureux)" },
  { value: "onyx", label: "Onyx (masculin grave)" },
  { value: "shimmer", label: "Shimmer (féminin doux)" },
];

type Dot = "ok" | "ko" | "unknown" | "loading";

function StatusDot({ state }: { state: Dot }) {
  if (state === "loading") return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (state === "ok") return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (state === "ko") return <XCircle className="w-4 h-4 text-red-600" />;
  return <span className="inline-block w-3 h-3 rounded-full bg-muted-foreground/40" />;
}

export default function Settings() {
  const { toast } = useToast();

  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [persist, setPersist] = useState(true);
  const [voice, setVoice] = useState<TtsVoice>(getPreferredVoice());

  const [openaiStatus, setOpenaiStatus] = useState<Dot>("unknown");
  const [anthropicStatus, setAnthropicStatus] = useState<Dot>("unknown");
  const [statusDetail, setStatusDetail] = useState<SettingsStatus | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Premier ping au montage pour afficher l'état actuel (les clés peuvent déjà être en .env.local).
  useEffect(() => {
    void runConnectionTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runConnectionTest() {
    setIsTesting(true);
    setOpenaiStatus("loading");
    setAnthropicStatus("loading");
    try {
      const status = await getSettingsStatus();
      setStatusDetail(status);
      setOpenaiStatus(status.openai_ok ? "ok" : "ko");
      setAnthropicStatus(status.anthropic_ok ? "ok" : "ko");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Échec de la requête";
      toast({ title: "Test de connexion échoué", description: msg, variant: "destructive" });
      setOpenaiStatus("ko");
      setAnthropicStatus("ko");
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);

    // On ne renvoie au backend que les champs réellement renseignés.
    const payload: { openaiKey?: string; anthropicKey?: string; persist?: boolean } = {
      persist,
    };
    if (openaiKey.trim().length > 0) payload.openaiKey = openaiKey.trim();
    if (anthropicKey.trim().length > 0) payload.anthropicKey = anthropicKey.trim();

    try {
      const result = await saveSettings(payload);
      setPreferredVoice(voice);
      toast({
        title: "Paramètres enregistrés",
        description: result.persisted
          ? "Les clés ont aussi été écrites dans .env.local."
          : "Clés en mémoire pour cette session uniquement.",
      });
      // Efface les champs clé du formulaire pour ne pas les laisser affichés.
      setOpenaiKey("");
      setAnthropicKey("");
      await runConnectionTest();
    } catch (err) {
      const e = err as ApiError;
      toast({
        title: "Enregistrement impossible",
        description: `${e.message}${e.hint ? ` — ${e.hint}` : ""}`,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function renderStatusLine(ok: Dot, reason?: string) {
    if (ok === "loading") return <span className="text-xs text-muted-foreground">Test en cours…</span>;
    if (ok === "ok") return <span className="text-xs text-green-700">Connexion validée</span>;
    if (ok === "ko") {
      const map: Record<string, string> = {
        not_configured: "Clé absente — renseignez-la ci-dessus.",
        unauthorized: "Clé rejetée par le fournisseur.",
        rate_limited: "Limite de requêtes atteinte.",
        upstream_error: "Service fournisseur indisponible.",
      };
      return (
        <span className="text-xs text-red-700">
          {reason ? (map[reason] ?? reason) : "Connexion impossible."}
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">Statut inconnu</span>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto animate-in fade-in duration-500">
      <header className="mb-10">
        <h1 className="text-4xl font-bold text-foreground mb-2 tracking-tight">Paramètres</h1>
        <p className="text-xl text-muted-foreground">Configurez vos clés d'API et la voix du patient.</p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-xl">
              <span className="flex items-center">
                <Bot className="w-5 h-5 mr-2 text-primary" /> OpenAI (Patient IA)
              </span>
              <span className="flex items-center gap-2">
                <StatusDot state={openaiStatus} />
              </span>
            </CardTitle>
            <CardDescription>GPT-4o-mini pour la conversation, Whisper pour la reconnaissance vocale, TTS pour la voix.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openai-key">Clé API OpenAI</Label>
              <Input
                id="openai-key"
                type="password"
                placeholder="sk-… (laisser vide pour conserver la clé actuelle)"
                className="font-mono"
                autoComplete="off"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                data-testid="input-openai-key"
              />
              {renderStatusLine(openaiStatus, statusDetail?.openai_reason)}
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-model">Voix du patient (TTS)</Label>
              <select
                id="voice-model"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={voice}
                onChange={(e) => setVoice(e.target.value as TtsVoice)}
                data-testid="select-voice"
              >
                {VOICES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Sauvegardé localement dans votre navigateur.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-xl">
              <span className="flex items-center">
                <Server className="w-5 h-5 mr-2 text-primary" /> Anthropic (Évaluateur)
              </span>
              <span className="flex items-center gap-2">
                <StatusDot state={anthropicStatus} />
              </span>
            </CardTitle>
            <CardDescription>Claude Sonnet 4.5 rédige le rapport d'évaluation structuré en fin de station.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="anthropic-key">Clé API Anthropic</Label>
              <Input
                id="anthropic-key"
                type="password"
                placeholder="sk-ant-… (laisser vide pour conserver la clé actuelle)"
                className="font-mono"
                autoComplete="off"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                data-testid="input-anthropic-key"
              />
              {renderStatusLine(anthropicStatus, statusDetail?.anthropic_reason)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardContent className="pt-6 flex items-start gap-3">
            <Checkbox
              id="persist"
              checked={persist}
              onCheckedChange={(v) => setPersist(v === true)}
              data-testid="checkbox-persist"
            />
            <div className="space-y-1">
              <Label htmlFor="persist" className="cursor-pointer">Persister les clés dans .env.local</Label>
              <p className="text-xs text-muted-foreground">
                Non coché : les clés restent en mémoire le temps de la session serveur. Coché : écrites
                dans <code className="font-mono">.env.local</code> (ignoré par git, permissions 0600).
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between items-center">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={runConnectionTest}
            disabled={isTesting}
            data-testid="button-test-connection"
          >
            {isTesting ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <PlugZap className="w-5 h-5 mr-2" />}
            Tester la connexion
          </Button>
          <Button type="submit" size="lg" className="px-8 shadow-md" disabled={isSaving} data-testid="button-save">
            {isSaving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
            Enregistrer
          </Button>
        </div>
      </form>
    </div>
  );
}
