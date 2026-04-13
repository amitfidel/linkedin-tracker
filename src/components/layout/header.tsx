"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sun, Moon, Play, Loader2, CheckCircle2, XCircle, AlertTriangle, ChevronDown, Star, Database } from "lucide-react";
import { toast } from "sonner";

interface ScrapeRun {
  id: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  companiesCount: number | null;
  creditsUsed: number | null;
  stepErrors: string | null;
}

type ScrapePhase = "idle" | "starting" | "running" | "done_ok" | "done_warn" | "done_err";

function useElapsedSeconds(startedAt: string | null) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () =>
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

function formatElapsed(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function Header() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [phase, setPhase] = useState<ScrapePhase>("idle");
  const [activeRun, setActiveRun] = useState<ScrapeRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsed = useElapsedSeconds(phase === "running" ? (activeRun?.startedAt ?? null) : null);

  // ── Poll the status endpoint ───────────────────────────────────────────────
  async function pollStatus() {
    try {
      const res = await fetch("/api/scrape/status");
      if (!res.ok) return;
      const runs: ScrapeRun[] = await res.json();
      const latest = runs[0];
      if (!latest) return;

      if (latest.status === "running") {
        setActiveRun(latest);
        setPhase("running");
      } else if (latest.status === "completed" || latest.status === "failed") {
        setActiveRun(latest);
        stopPolling();

        const errors: string[] = latest.stepErrors ? JSON.parse(latest.stepErrors) : [];
        if (latest.status === "failed") {
          setPhase("done_err");
          toast.error(`Scrape failed after ${formatElapsed(
            latest.completedAt
              ? Math.floor((new Date(latest.completedAt).getTime() - new Date(latest.startedAt).getTime()) / 1000)
              : 0
          )}`);
        } else if (errors.length > 0) {
          setPhase("done_warn");
          toast.warning(`Scrape completed with ${errors.length} warning(s). Check Settings for details.`);
        } else {
          setPhase("done_ok");
          toast.success(
            `Scrape done in ${formatElapsed(
              latest.completedAt
                ? Math.floor((new Date(latest.completedAt).getTime() - new Date(latest.startedAt).getTime()) / 1000)
                : 0
            )} · ${latest.companiesCount ?? 0} companies · $${(latest.creditsUsed ?? 0).toFixed(4)}`
          );
        }
        // Refresh page data so new scrape results appear automatically
        router.refresh();
        // Auto-reset button after 8 seconds
        setTimeout(() => {
          setPhase("idle");
          setActiveRun(null);
        }, 8000);
      }
    } catch {
      // Ignore poll errors — next tick will retry
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(pollStatus, 4000);
    // First poll immediately after a short delay to let the run record be created
    setTimeout(pollStatus, 1000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Clean up on unmount
  useEffect(() => () => stopPolling(), []);

  // ── Trigger scrape ────────────────────────────────────────────────────────
  async function handleScrape(mode: "full" | "gartner" = "full") {
    setPhase("starting");
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (res.ok) {
        setPhase("running");
        startPolling();
        toast.info(mode === "gartner"
          ? "Gartner scrape started — takes ~2 minutes."
          : "Scrape started — this takes 5-15 minutes.");
      } else {
        setPhase("idle");
        toast.error(data.error || "Failed to start scrape");
      }
    } catch {
      setPhase("idle");
      toast.error("Network error — could not start scrape");
    }
  }

  // ── Button appearance ──────────────────────────────────────────────────────
  const isDisabled = phase === "starting" || phase === "running";

  const buttonContent = () => {
    switch (phase) {
      case "starting":
        return <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</>;
      case "running":
        return <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running ({formatElapsed(elapsed)})</>;
      case "done_ok":
        return <><CheckCircle2 className="mr-2 h-4 w-4 text-green-500" /> Done</>;
      case "done_warn":
        return <><AlertTriangle className="mr-2 h-4 w-4 text-yellow-500" /> Done (warnings)</>;
      case "done_err":
        return <><XCircle className="mr-2 h-4 w-4 text-red-500" /> Failed</>;
      default:
        return <><Play className="mr-2 h-4 w-4" /> Run Scrape</>;
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div>
        <h2 className="text-sm text-muted-foreground">
          LinkedIn Intelligence Dashboard
        </h2>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleScrape("full")}
            disabled={isDisabled}
            className="rounded-r-none border-r-0"
          >
            {buttonContent()}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className="inline-flex items-center justify-center rounded-r-md rounded-l-none border border-l-0 border-input bg-background px-2 py-1.5 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleScrape("full")}>
                <Play className="mr-2 h-4 w-4" />
                Full scrape (LinkedIn + Gartner)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  toast.info(
                    "Run locally: npx tsx scripts/run-gartner-local.ts",
                    { description: "Gartner scrape uses your local Chrome browser, then pushes results here.", duration: 8000 }
                  );
                }}
              >
                <Star className="mr-2 h-4 w-4" />
                Gartner only (local)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </div>
    </header>
  );
}
