"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Sparkles, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";

export function AISummary() {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  async function fetchSummary(forceRefresh = false) {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const url = forceRefresh
        ? "/api/dashboard/summary?refresh=1"
        : "/api/dashboard/summary";
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to load summary");

      setSummary(data.summary);
      setGeneratedAt(data.generatedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchSummary();
  }, []);

  return (
    <Card className="p-5 border-l-4 border-l-violet-500 bg-gradient-to-r from-violet-500/5 to-transparent">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <h2 className="font-semibold text-sm">AI Weekly Brief</h2>
          <span className="text-xs text-muted-foreground">
            — partnerships, launches & key events
          </span>
        </div>
        <div className="flex items-center gap-2">
          {generatedAt && !loading && (
            <span className="text-xs text-muted-foreground">
              {new Date(generatedAt).toLocaleDateString("en-US", {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => fetchSummary(true)}
            disabled={loading || refreshing}
            title="Regenerate summary from latest posts"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating AI summary…
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 text-sm text-destructive py-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Could not generate summary</p>
            <p className="text-muted-foreground text-xs mt-0.5">{error}</p>
            {error.includes("GEMINI_API_KEY") && (
              <p className="text-xs mt-1">
                Add <code className="bg-muted px-1 rounded">GEMINI_API_KEY</code> to your{" "}
                <code className="bg-muted px-1 rounded">.env</code> file.
                Get a free key at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline">
                  aistudio.google.com
                </a>
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-sm prose-headings:font-semibold prose-headings:mb-1 prose-ul:mt-1 prose-li:my-0.5 prose-p:my-1">
          <ReactMarkdown>{summary ?? ""}</ReactMarkdown>
        </div>
      )}
    </Card>
  );
}
