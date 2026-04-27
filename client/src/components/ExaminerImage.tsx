// Rendu d'une image médicale dans la bulle examinateur (Phase 3).
// - Thumbnail cliquable dans la bulle.
// - Zoom plein écran via Dialog Radix (le clic ou la touche Enter ouvre).
// - Caption optionnelle affichée sous l'image.
//
// Source des images : `public/medical-images/<station-id>/<slug>.<ext>`,
// licence CC-BY / CC0 / domaine public / création originale. Attribution
// vérifiée dans l'ATTRIBUTIONS.md de chaque station.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ExaminerImageProps {
  url: string;
  alt: string;
  caption?: string;
  maneuver?: string;
  className?: string;
}

export function ExaminerImage({ url, alt, caption, maneuver, className }: ExaminerImageProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "group relative block mt-2 overflow-hidden rounded-lg border border-slate-300 bg-slate-50 shadow-sm hover:shadow-md transition-shadow cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary/50",
            className,
          )}
          aria-label={`Agrandir l'image : ${alt}`}
          data-testid="examiner-image-trigger"
        >
          <img
            src={url}
            alt={alt}
            className="block max-w-full max-h-64 object-contain mx-auto"
            loading="lazy"
          />
          {caption && (
            <span className="block text-xs text-slate-600 px-3 py-1.5 bg-slate-100 border-t border-slate-200 italic">
              {caption}
            </span>
          )}
          <span className="absolute top-1 right-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Cliquer pour agrandir
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl p-0 bg-black border-0" data-testid="examiner-image-zoom">
        <DialogTitle className="sr-only">{maneuver ?? "Image examinateur"}</DialogTitle>
        <DialogDescription className="sr-only">
          {caption ?? alt}
        </DialogDescription>
        <div className="flex flex-col items-center justify-center w-full h-full">
          <img
            src={url}
            alt={alt}
            className="max-w-full max-h-[85vh] object-contain"
          />
          {(caption || maneuver) && (
            <div className="w-full bg-black/80 text-white text-sm p-3 text-center">
              {maneuver && <span className="font-semibold mr-2">{maneuver}</span>}
              {caption && <span className="italic text-slate-300">{caption}</span>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
