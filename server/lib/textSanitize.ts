// Nettoyage de texte pour envoi au TTS.
// OpenAI TTS prononcerait littéralement "emoji chronomètre" pour ⏱️ — on les retire.
//
// La plupart des emojis sont dans les plans supplémentaires (U+1F300+) et sont encodés
// en UTF-16 par une paire de substituts (high + low surrogate). On les matche via les
// plages de substituts pour rester compatible sans flag `u` / `target: es6+`.
const EMOJI_RE = new RegExp(
  [
    "[\uD83C-\uD83F][\uDC00-\uDFFF]", // plans supplémentaires (U+1F000+)
    "[⌀-➿]",                // misc technical → dingbats (U+2300-U+27BF)
    "[⬀-⯿]",                // supplemental arrows / symbols (U+2B00-U+2BFF)
    "️",                         // variation selector
    "‍",                         // zero-width joiner
  ].join("|"),
  "g",
);

/**
 * Supprime les emojis et compacte les espaces.
 * Conserve la ponctuation et les caractères français accentués.
 */
export function sanitizeForTts(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .trim();
}
