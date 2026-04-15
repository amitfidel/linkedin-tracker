"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ErrorBadgeProps {
  runId: number;
  errors: string[];
  onAcknowledged?: () => void;
}

/**
 * Shows a clickable badge with the number of step errors from the most recent
 * scrape run. Clicking opens a dialog listing the errors with a Dismiss button
 * that calls PATCH /api/scrape/{runId}/acknowledge.
 */
export function ErrorBadge({ runId, errors, onAcknowledged }: ErrorBadgeProps) {
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  async function handleDismiss() {
    setDismissing(true);
    try {
      const res = await fetch(`/api/scrape/${runId}/acknowledge`, {
        method: "PATCH",
      });
      if (res.ok) {
        setOpen(false);
        onAcknowledged?.();
      } else {
        toast.error("Failed to dismiss errors");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDismissing(false);
    }
  }

  if (errors.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-950/40 px-3 py-1 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
            aria-label={`${errors.length} scrape warning${errors.length > 1 ? "s" : ""}`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {errors.length} warning{errors.length > 1 ? "s" : ""}
          </button>
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Scrape completed with {errors.length} warning{errors.length > 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Run #{runId} finished, but some steps reported errors. Review them below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {errors.map((err, i) => (
            <pre
              key={i}
              className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap break-words font-mono"
            >
              {err}
            </pre>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={handleDismiss} disabled={dismissing}>
            {dismissing ? "Dismissing..." : "Dismiss"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
