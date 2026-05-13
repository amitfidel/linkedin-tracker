"use client";

import Link from "next/link";
import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, ExternalLink, Loader2, TrendingUp } from "lucide-react";

interface ClientRow {
  id: number;
  name: string;
  linkedinUrl: string;
  industry: string | null;
  logoUrl: string | null;
  employeeCount: number | null;
  rosterSize: number;
  weekInteractions: number;
  totalInteractions: number;
  leadScore: number;
  topCompetitor: string | null;
  latestInteraction: {
    summary: string | null;
    signalType: string;
    detectedAt: string | null;
  } | null;
}

function scoreBadgeClass(score: number): string {
  if (score >= 100) return "bg-rose-500/20 text-rose-600 dark:text-rose-300";
  if (score >= 60) return "bg-amber-500/20 text-amber-700 dark:text-amber-300";
  if (score >= 30) return "bg-sky-500/20 text-sky-700 dark:text-sky-300";
  return "bg-muted text-muted-foreground";
}

function signalLabel(t: string): string {
  if (t === "personnel_move") return "Personnel move";
  if (t === "post_engagement") return "Engagement";
  if (t === "post_mention") return "Mention";
  return t;
}

export default function ClientsPage() {
  const { data, loading } = useFetch<{ clients: ClientRow[] }>("/api/clients");
  const clients = data?.clients ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Eye className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Client Watch</h1>
          <p className="text-sm text-muted-foreground">
            Track which of your clients are engaging with competitor companies. Import
            via{" "}
            <code className="bg-muted px-1 rounded">
              npx tsx scripts/import-clients.ts clients.csv
            </code>
            .
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading clients…
        </div>
      ) : clients.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No clients imported yet. Create a <code>clients.csv</code> with{" "}
          <code>name,linkedinUrl</code> rows and run the import script.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {clients.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`}>
              <Card className="p-4 hover:bg-muted/30 transition-colors h-full flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {c.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.logoUrl}
                        alt=""
                        className="h-8 w-8 rounded object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-semibold">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold truncate flex items-center gap-2">
                        <span className="truncate">{c.name}</span>
                        {c.leadScore > 0 && (
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${scoreBadgeClass(c.leadScore)}`}
                            title={`30-day warmth score${c.topCompetitor ? ` · top vs ${c.topCompetitor}` : ""}`}
                          >
                            {c.leadScore}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.industry ?? "—"}
                        {c.topCompetitor && (
                          <span> · vs {c.topCompetitor}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <a
                    href={c.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-muted/40 rounded p-2">
                    <div className="text-lg font-semibold">{c.rosterSize}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Roster
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded p-2">
                    <div className="text-lg font-semibold flex items-center justify-center gap-1">
                      {c.weekInteractions}
                      {c.weekInteractions > 0 && (
                        <TrendingUp className="h-3 w-3 text-emerald-500" />
                      )}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      This week
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded p-2">
                    <div className="text-lg font-semibold">{c.totalInteractions}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      All-time
                    </div>
                  </div>
                </div>

                {c.latestInteraction && (
                  <div className="text-xs text-muted-foreground border-t pt-3 flex items-start gap-2">
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {signalLabel(c.latestInteraction.signalType)}
                    </Badge>
                    <span className="line-clamp-2">
                      {c.latestInteraction.summary ?? "(no summary)"}
                    </span>
                  </div>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
