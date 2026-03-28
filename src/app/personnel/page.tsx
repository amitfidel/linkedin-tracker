"use client";

import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, UserMinus, ArrowRightLeft } from "lucide-react";

interface PersonnelChange {
  id: number;
  companyName: string;
  companyId: number;
  changeType: string;
  personName: string | null;
  oldTitle: string | null;
  newTitle: string | null;
  detectedAt: string | null;
}

export default function PersonnelPage() {
  const { data, loading } = useFetch<PersonnelChange[]>(
    "/api/dashboard/personnel?days=90"
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const changes = data || [];

  const iconMap = {
    joined: <UserPlus className="h-5 w-5 text-green-500" />,
    left: <UserMinus className="h-5 w-5 text-red-500" />,
    title_change: <ArrowRightLeft className="h-5 w-5 text-yellow-500" />,
  };

  const badgeMap = {
    joined: { variant: "default" as const, label: "Joined" },
    left: { variant: "destructive" as const, label: "Left" },
    title_change: { variant: "secondary" as const, label: "Title Change" },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Personnel Changes</h1>
        <p className="text-sm text-muted-foreground">
          Key personnel movements across tracked companies (last 90 days)
        </p>
      </div>

      {changes.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <UserPlus className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No personnel changes yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Personnel changes are detected by comparing scrape results over time.
            Run at least 2 scrapes to start seeing changes.
          </p>
        </Card>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-4">
            {changes.map((change) => {
              const badge =
                badgeMap[change.changeType as keyof typeof badgeMap] ||
                badgeMap.joined;
              return (
                <div key={change.id} className="relative flex items-start gap-4 pl-14">
                  {/* Timeline dot */}
                  <div className="absolute left-4 mt-1 rounded-full bg-card p-1 border">
                    {iconMap[change.changeType as keyof typeof iconMap]}
                  </div>

                  <Card className="flex-1 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{change.personName}</span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {change.detectedAt
                          ? new Date(change.detectedAt).toLocaleDateString()
                          : ""}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {change.companyName}
                      </span>
                      {change.changeType === "title_change" && (
                        <span>
                          {" "}&mdash; {change.oldTitle} &rarr; {change.newTitle}
                        </span>
                      )}
                      {change.changeType === "joined" && change.newTitle && (
                        <span> as {change.newTitle}</span>
                      )}
                      {change.changeType === "left" && change.oldTitle && (
                        <span> (was {change.oldTitle})</span>
                      )}
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
