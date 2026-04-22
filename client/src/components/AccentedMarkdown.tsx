import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type AccentKind,
  tokenizeAccents,
} from "@/lib/reportAccents";
import { classifyStatusCell } from "@/lib/reportFormatting";

// ─────────── Styles des accents ───────────
// Chaque accent est rendu en <span> stylé Tailwind. Contraste AA vérifié sur fond
// blanc (≥ 4.5:1 pour toutes les teintes 700).

const ACCENT_CLASSES: Record<AccentKind, string> = {
  problem: "font-semibold text-red-700",
  action: "font-semibold text-blue-700",
  benefit: "font-semibold text-emerald-700",
  covered: "font-semibold text-emerald-700",
  missing: "font-semibold text-red-700",
  mnemonic: "font-mono font-semibold text-indigo-700 bg-indigo-50 px-1 rounded",
  percent: "font-mono font-semibold text-foreground",
  fraction: "font-mono font-semibold text-foreground",
};

// Transforme une chaîne de texte en nœuds React avec spans colorés pour les
// patterns reconnus. Conserve les espaces et la ponctuation, ne dédouble pas le
// texte — chaque caractère d'entrée apparaît exactement une fois en sortie.
function renderAccentedString(input: string, keyPrefix: string): React.ReactNode[] {
  const tokens = tokenizeAccents(input);
  return tokens.map((t, i) => {
    if (t.accent === null) return t.text;
    return (
      <span key={`${keyPrefix}-${i}`} className={ACCENT_CLASSES[t.accent]}>
        {t.text}
      </span>
    );
  });
}

// Remplace récursivement les nœuds string par leurs versions accentuées. On
// évite de descendre dans les <code>, <pre> et <table> — ces contextes ne
// doivent pas être colorés (risque de casser l'alignement / la sémantique).
const SKIP_ELEMENTS = new Set(["code", "pre", "table", "thead", "tbody", "tr", "th", "td"]);

function accentNode(node: React.ReactNode, keyPrefix: string): React.ReactNode {
  if (typeof node === "string") {
    return renderAccentedString(node, keyPrefix);
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => accentNode(child, `${keyPrefix}.${i}`));
  }
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    const type = typeof el.type === "string" ? el.type : null;
    if (type && SKIP_ELEMENTS.has(type)) return el;
    const children = el.props?.children;
    if (children === undefined || children === null) return el;
    return React.cloneElement(el, undefined, accentNode(children, `${keyPrefix}.c`));
  }
  return node;
}

function AccentedChildren({ children }: { children?: React.ReactNode }) {
  return <>{accentNode(children, "a")}</>;
}

// ─────────── Styles des badges de statut (colonne Statut des tableaux) ───────────

function StatusBadge({ children }: { children: React.ReactNode }) {
  const text = React.Children.toArray(children).map((c) => (typeof c === "string" ? c : "")).join("");
  const { icon, label } = classifyStatusCell(text);

  const classes =
    icon === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
    icon === "partial" ? "bg-amber-50 text-amber-800 border-amber-200" :
    icon === "missing" ? "bg-red-50 text-red-800 border-red-200" :
    icon === "na" || icon === "unknown" ? "bg-muted/60 text-muted-foreground border-border" :
    "text-foreground";

  const badge = (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        classes,
      )}
    >
      {children}
    </span>
  );

  if (!label) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block cursor-help">{badge}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-center">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ─────────── Renderers Markdown ───────────

function firstColumnClass(index: number): string {
  return index === 0 ? "font-mono text-xs text-muted-foreground w-12" : "";
}

export const markdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="text-2xl font-bold text-foreground mt-6 mb-3" {...props}>
      <AccentedChildren>{children}</AccentedChildren>
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="text-xl font-bold text-primary mt-8 mb-4 pb-2 border-b border-primary/20 uppercase tracking-wide"
      {...props}
    >
      <AccentedChildren>{children}</AccentedChildren>
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-lg font-semibold mt-6 mb-3 text-foreground" {...props}>
      <AccentedChildren>{children}</AccentedChildren>
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="text-base font-semibold mt-4 mb-2 text-foreground" {...props}>
      <AccentedChildren>{children}</AccentedChildren>
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p className="text-[0.95rem] leading-relaxed text-foreground mb-3" {...props}>
      <AccentedChildren>{children}</AccentedChildren>
    </p>
  ),
  li: ({ children, ...props }) => (
    <li className="mb-1" {...props}>
      <AccentedChildren>{children}</AccentedChildren>
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-foreground" {...props}>
      <AccentedChildren>{children}</AccentedChildren>
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic" {...props}>
      <AccentedChildren>{children}</AccentedChildren>
    </em>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-4 border-primary/40 bg-primary/5 pl-4 pr-3 py-2 my-3 rounded-r text-foreground"
      {...props}
    >
      <AccentedChildren>{children}</AccentedChildren>
    </blockquote>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc pl-6 mb-3 space-y-1" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal pl-6 mb-3 space-y-1" {...props}>
      {children}
    </ol>
  ),
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-4">
      <table
        className="w-full border-collapse rounded-lg overflow-hidden text-sm shadow-sm border border-border"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-muted/60" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
  tr: ({ children, ...props }) => <tr {...props}>{children}</tr>,
  th: ({ children, ...props }) => (
    <th
      className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase text-xs tracking-wider"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, node, ...props }) => {
    // Identifie la colonne courante via l'index de la cellule dans la ligne.
    // `node` est l'hAST Node ; on s'appuie sur sa position dans le <tr> parent
    // via la propriété `position` — moins fiable qu'un compte, donc on passe
    // plutôt par le header présent juste au-dessus dans le DOM en inspectant
    // le texte. Version simple : on détecte les colonnes sensibles (# et Statut)
    // via le contenu brut de la cellule.
    const raw = React.Children.toArray(children)
      .map((c) => (typeof c === "string" ? c : ""))
      .join("");
    const { icon } = classifyStatusCell(raw);
    const isIdCell = /^\s*[a-z]\d+\s*$/i.test(raw) || /^\s*\d+\s*$/.test(raw);

    if (icon) {
      return (
        <td className="px-4 py-2.5 border-t border-border align-top w-24" {...props}>
          <StatusBadge>{children}</StatusBadge>
        </td>
      );
    }
    return (
      <td
        className={cn("px-4 py-2.5 border-t border-border align-top", isIdCell && firstColumnClass(0))}
        {...props}
      >
        <AccentedChildren>{children}</AccentedChildren>
      </td>
    );
  },
  code: ({ children, ...props }) => (
    <code className="bg-muted px-1 py-0.5 rounded text-[0.85em] font-mono" {...props}>
      {children}
    </code>
  ),
  hr: () => <hr className="border-border my-6" />,
};

interface AccentedMarkdownProps {
  children: string;
  className?: string;
}

export function AccentedMarkdown({ children, className }: AccentedMarkdownProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className={className}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {children}
        </ReactMarkdown>
      </div>
    </TooltipProvider>
  );
}
