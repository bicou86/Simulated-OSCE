// Hook générique d'écoute de raccourcis clavier sur window.
//
// Règles standards :
// - Ignore si la cible est INPUT / TEXTAREA / [contenteditable] (pour ne pas intercepter
//   la saisie texte du candidat pendant une simulation).
// - Ignore pendant event.isComposing (saisie IME — kanji, accents morts, etc.).
// - Ignore les combinaisons avec Ctrl / Meta / Alt sauf si le handler le demande
//   explicitement via la notation "mod+k".
// - Option `enabled` : désactive tous les raccourcis (ex. quand la simulation n'est pas
//   active ou est timeout).

import { useEffect, useRef } from "react";

export type ShortcutHandler = (e: KeyboardEvent) => void;
export type ShortcutMap = Record<string, ShortcutHandler>;

export interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
}

// Normalise la touche saisie en une clé comparable à notre map.
// "Escape" reste "Escape" ; les lettres sont mises en minuscule ("M" → "m").
function normalizeKey(e: KeyboardEvent): string {
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key;
}

function targetIsInputLike(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(
  shortcuts: ShortcutMap,
  options: UseKeyboardShortcutsOptions = {},
): void {
  const { enabled = true } = options;
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => { shortcutsRef.current = shortcuts; }, [shortcuts]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // pas de modif par défaut
      if (targetIsInputLike(e.target)) return;

      const key = normalizeKey(e);
      const fn = shortcutsRef.current[key];
      if (!fn) return;
      // On empêche le comportement par défaut (ex. "Escape" qui ferme des modales parentes).
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
