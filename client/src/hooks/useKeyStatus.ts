// Hook partagé : interroge /api/settings/status une fois au montage.
// Permet d'afficher une bannière "clés non configurées" et de bloquer les simulations.

import { useEffect, useState } from "react";
import { getSettingsStatus, type SettingsStatus } from "@/lib/api";

interface State {
  loading: boolean;
  status: SettingsStatus | null;
  error: string | null;
}

export function useKeyStatus(): State & { refresh: () => Promise<void> } {
  const [state, setState] = useState<State>({ loading: true, status: null, error: null });

  async function refresh() {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const status = await getSettingsStatus();
      setState({ loading: false, status, error: null });
    } catch (err) {
      setState({ loading: false, status: null, error: (err as Error).message });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { ...state, refresh };
}
