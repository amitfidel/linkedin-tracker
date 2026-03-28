"use client";

import { Card } from "@/components/ui/card";
import { Building2, Briefcase, MessageSquare, Users, TrendingUp } from "lucide-react";

interface StatsCardsProps {
  totalCompanies: number;
  totalActiveJobs: number;
  newPostsCount: number;
  newJobsCount: number;
  personnelChangesCount: number;
}

const stats = [
  { key: "totalCompanies", label: "Companies Tracked", icon: Building2, color: "text-blue-500" },
  { key: "totalActiveJobs", label: "Active Job Listings", icon: Briefcase, color: "text-green-500" },
  { key: "newPostsCount", label: "New Posts (7d)", icon: MessageSquare, color: "text-purple-500" },
  { key: "newJobsCount", label: "New Jobs (7d)", icon: TrendingUp, color: "text-orange-500" },
  { key: "personnelChangesCount", label: "Personnel Changes (7d)", icon: Users, color: "text-red-500" },
] as const;

export function StatsCards(props: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => (
        <Card key={stat.key} className="p-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg bg-muted p-2 ${stat.color}`}>
              <stat.icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-2xl font-bold">{props[stat.key]}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
