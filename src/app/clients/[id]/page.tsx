"use client";

import { use } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ExternalLink, Loader2 } from "lucide-react";

interface Interaction {
  id: number;
  signalType: string;
  summary: string | null;
  matchedBy: string | null;
  engagerName: string | null;
  engagerProfileUrl: string | null;
  competitorCompanyId: number;
  competitorName: string;
  postId: number | null;
  post: { id: number; url: string | null; snippet: string | null; postedAt: string | null } | null | undefined;
  detectedAt: string | null;
}

interface ClientDetail {
  client: {
    id: number;
    name: string;
    linkedinUrl: string;
    industry: string | null;
    description: string | null;
    logoUrl: string | null;
    website: string | null;
    employeeCount: number | null;
  };
  interactions: Interaction[];
}

function signalLabel(t: string): string {
  if (t === "personnel_move") return "Personnel move";
  if (t === "post_engagement") return "Engagement";
  if (t === "post_mention") return "Mention";
  return t;
}

function signalColor(t: string): string {
  if (t === "personnel_move") return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
  if (t === "post_engagement") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (t === "post_mention") return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
  return "bg-muted text-muted-foreground";
}

export default function ClientDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(props.params);
  const { data, loading } = useFetch<ClientDetail>(`/api/clients/${id}`);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!data) {
    return <div className="text-muted-foreground">Client not found.</div>;
  }
  const { client, interactions } = data;

  // Group by signal type for tabs-as-sections
  const byType: Record<string, Interaction[]> = {};
  for (const i of interactions) {
    (byType[i.signalType] ??= []).push(i);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clients"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> All clients
        </Link>
      </div>

      <div className="flex items-start gap-4">
        {client.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={client.logoUrl} alt="" className="h-14 w-14 rounded object-cover" />
        ) : (
          <div className="h-14 w-14 rounded bg-muted flex items-center justify-center text-lg font-semibold">
            {client.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <div className="text-sm text-muted-foreground">
            {client.industry ?? "—"} ·{" "}
            <a
              href={client.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              LinkedIn <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {client.description && (
            <p className="text-sm text-muted-foreground mt-2 line-clamp-3">
              {client.description}
            </p>
          )}
        </div>
      </div>

      {interactions.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No interactions detected yet. They&apos;ll appear here after the next
          weekly scrape if anyone from {client.name} engages with a tracked competitor.
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(byType).map(([type, items]) => (
            <section key={type}>
              <div className="flex items-center gap-3 mb-3">
                <Badge className={signalColor(type)}>{signalLabel(type)}</Badge>
                <span className="text-sm text-muted-foreground">
                  {items.length} {items.length === 1 ? "event" : "events"}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((i) => (
                  <Card key={i.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                          <span>{i.engagerName ?? "—"}</span>
                          <span className="text-muted-foreground">↔</span>
                          <Badge variant="outline">{i.competitorName}</Badge>
                          {i.matchedBy && (
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              via {i.matchedBy}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {i.summary ?? "(no summary)"}
                        </div>
                        {i.post?.snippet && (
                          <div className="text-xs text-muted-foreground mt-2 border-l-2 pl-2 line-clamp-2">
                            {i.post.snippet}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="text-xs text-muted-foreground">
                          {i.detectedAt?.slice(0, 10) ?? ""}
                        </div>
                        {i.post?.url && (
                          <a
                            href={i.post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          >
                            Post <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
