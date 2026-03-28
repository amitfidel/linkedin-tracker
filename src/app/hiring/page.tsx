"use client";

import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface HiringData {
  jobCounts: Array<{
    companyId: number;
    companyName: string;
    count: number;
    week: string;
  }>;
  topSkills: Array<{ name: string; count: number }>;
  activeJobsByCompany: Array<{
    companyId: number;
    companyName: string;
    activeJobs: number;
  }>;
}

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#f97316", "#14b8a6", "#6366f1",
];

export default function HiringPage() {
  const { data, loading } = useFetch<HiringData>("/api/dashboard/hiring?days=30");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hiring = data || { jobCounts: [], topSkills: [], activeJobsByCompany: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hiring Trends</h1>
        <p className="text-sm text-muted-foreground">
          Job posting analysis across tracked companies
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active jobs by company */}
        <Card className="p-4">
          <h3 className="mb-4 text-sm font-semibold">Active Job Listings by Company</h3>
          {hiring.activeJobsByCompany.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No job data yet. Run a scrape to collect data.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hiring.activeJobsByCompany} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" className="text-xs" />
                <YAxis
                  type="category"
                  dataKey="companyName"
                  width={120}
                  className="text-xs"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="activeJobs" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Top skills */}
        <Card className="p-4">
          <h3 className="mb-4 text-sm font-semibold">
            Top Skills & Technologies (Last 30 Days)
          </h3>
          {hiring.topSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No skill data yet
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hiring.topSkills.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="name"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  className="text-xs"
                />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Skills distribution pie chart */}
      {hiring.topSkills.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-4 text-sm font-semibold">Skills Distribution</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {hiring.topSkills.slice(0, 15).map((skill, i) => (
              <Badge
                key={skill.name}
                variant="outline"
                style={{ borderColor: COLORS[i % COLORS.length] }}
              >
                {skill.name} ({skill.count})
              </Badge>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={hiring.topSkills.slice(0, 10)}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) =>
                  `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                }
              >
                {hiring.topSkills.slice(0, 10).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}
