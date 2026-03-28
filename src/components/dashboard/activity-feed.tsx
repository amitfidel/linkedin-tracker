"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPlus, UserMinus, ArrowRightLeft } from "lucide-react";

interface PersonnelChange {
  companyName: string;
  changeType: string;
  personName: string | null;
  oldTitle: string | null;
  newTitle: string | null;
  detectedAt: string | null;
}

interface ActivityFeedProps {
  personnelChanges: PersonnelChange[];
  postsByCompany: Array<{
    companyName: string;
    postCount: number;
    totalLikes: number;
  }>;
  jobsByCompany: Array<{
    companyName: string;
    jobCount: number;
  }>;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ActivityFeed({
  personnelChanges,
  postsByCompany,
  jobsByCompany,
}: ActivityFeedProps) {
  const changeIcon = {
    joined: <UserPlus className="h-4 w-4 text-green-500" />,
    left: <UserMinus className="h-4 w-4 text-red-500" />,
    title_change: <ArrowRightLeft className="h-4 w-4 text-yellow-500" />,
  };

  const changeBadge = {
    joined: "default" as const,
    left: "destructive" as const,
    title_change: "secondary" as const,
  };

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold">This Week's Activity</h3>
      <ScrollArea className="h-80">
        <div className="space-y-3">
          {/* Post activity */}
          {postsByCompany.map((p) => (
            <div
              key={`post-${p.companyName}`}
              className="flex items-start gap-3 rounded-lg border p-3"
            >
              <div className="rounded-full bg-purple-500/10 p-1.5">
                <span className="text-xs">📝</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{p.companyName}</span> published{" "}
                  {p.postCount} post{p.postCount > 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.totalLikes} total likes
                </p>
              </div>
            </div>
          ))}

          {/* Job activity */}
          {jobsByCompany.map((j) => (
            <div
              key={`job-${j.companyName}`}
              className="flex items-start gap-3 rounded-lg border p-3"
            >
              <div className="rounded-full bg-green-500/10 p-1.5">
                <span className="text-xs">💼</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{j.companyName}</span> posted{" "}
                  {j.jobCount} new job{j.jobCount > 1 ? "s" : ""}
                </p>
              </div>
            </div>
          ))}

          {/* Personnel changes */}
          {personnelChanges.map((change, i) => (
            <div
              key={`change-${i}`}
              className="flex items-start gap-3 rounded-lg border p-3"
            >
              <div className="mt-0.5">
                {changeIcon[change.changeType as keyof typeof changeIcon]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{change.personName}</p>
                  <Badge
                    variant={
                      changeBadge[change.changeType as keyof typeof changeBadge]
                    }
                    className="text-xs"
                  >
                    {change.changeType}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {change.companyName}
                  {change.changeType === "title_change" &&
                    ` - ${change.oldTitle} -> ${change.newTitle}`}
                  {change.changeType === "joined" && change.newTitle &&
                    ` as ${change.newTitle}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(change.detectedAt)}
                </p>
              </div>
            </div>
          ))}

          {personnelChanges.length === 0 &&
            postsByCompany.length === 0 &&
            jobsByCompany.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                No activity yet. Add companies and run your first scrape!
              </p>
            )}
        </div>
      </ScrollArea>
    </Card>
  );
}
