"use client";

import { useState } from "react";
import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Save, Clock } from "lucide-react";
import { toast } from "sonner";

interface ScheduleData {
  id: number;
  cronExpression: string;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface ScrapeRun {
  id: number;
  triggerType: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  companiesCount: number | null;
  creditsUsed: number | null;
  errorMessage: string | null;
  stepErrors: string | null; // JSON array of per-step error strings
}

const SCHEDULE_PRESETS = [
  { label: "Every Monday 2 AM", value: "0 2 * * 1" },
  { label: "Every Sunday 2 AM", value: "0 2 * * 0" },
  { label: "Every day 6 AM", value: "0 6 * * *" },
  { label: "Twice a week (Mon, Thu)", value: "0 2 * * 1,4" },
  { label: "Custom", value: "custom" },
];

export default function SettingsPage() {
  const { data: schedule, loading: scheduleLoading } =
    useFetch<ScheduleData>("/api/schedule");
  const { data: runs, loading: runsLoading } =
    useFetch<ScrapeRun[]>("/api/scrape/status");

  const [cronExpression, setCronExpression] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("");

  // Sync state once loaded
  if (schedule && !cronExpression && !selectedPreset) {
    setCronExpression(schedule.cronExpression || "0 2 * * 1");
    setIsEnabled(schedule.isEnabled ?? true);
    const preset = SCHEDULE_PRESETS.find(
      (p) => p.value === schedule.cronExpression
    );
    setSelectedPreset(preset ? preset.value : "custom");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronExpression, isEnabled }),
      });
      if (res.ok) {
        toast.success("Schedule saved");
      } else {
        toast.error("Failed to save schedule");
      }
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (scheduleLoading || runsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure scraping schedule and view run history
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Schedule config */}
        <Card className="p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Scrape Schedule
          </h3>

          <div className="flex items-center justify-between">
            <Label>Auto-scrape enabled</Label>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </div>

          <div>
            <Label>Schedule Preset</Label>
            <Select
              value={selectedPreset}
              onValueChange={(val) => {
                if (!val) return;
                setSelectedPreset(val);
                if (val !== "custom") {
                  setCronExpression(val);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPreset === "custom" && (
            <div>
              <Label>Cron Expression</Label>
              <Input
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder="0 2 * * 1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Format: minute hour day-of-month month day-of-week
              </p>
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Schedule
          </Button>
        </Card>

        {/* API status */}
        <Card className="p-4 space-y-4">
          <h3 className="text-sm font-semibold">API Configuration</h3>
          <div className="space-y-2">
            <Label>Apify API Token</Label>
            <p className="text-xs text-muted-foreground">
              Set in <code className="bg-muted px-1 rounded">.env</code> file as{" "}
              <code className="bg-muted px-1 rounded">APIFY_API_TOKEN</code>
            </p>
            <Badge variant={process.env.NEXT_PUBLIC_HAS_TOKEN ? "default" : "secondary"}>
              {process.env.NEXT_PUBLIC_HAS_TOKEN ? "Configured" : "Check .env file"}
            </Badge>
          </div>

          <div className="border-t pt-3">
            <h4 className="text-xs font-medium mb-2">Credit Usage Tips</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>Free tier: $5/month in Apify credits</li>
              <li>~3 actor runs per weekly scrape (batched)</li>
              <li>10 companies x 4 weeks = ~12 runs/month</li>
              <li>Monitor credits in scrape history below</li>
            </ul>
          </div>
        </Card>
      </div>

      {/* Scrape history */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Scrape History</h3>
        {(!runs || runs.length === 0) ? (
          <p className="text-sm text-muted-foreground">No scrapes run yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Companies</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const stepErrors: string[] = run.stepErrors ? JSON.parse(run.stepErrors) : [];
                const hasWarnings = stepErrors.length > 0;
                return (
                <TableRow key={run.id}>
                  <TableCell className="text-xs">
                    {new Date(run.startedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{run.triggerType}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        run.status === "completed" && !hasWarnings
                          ? "default"
                          : run.status === "failed"
                            ? "destructive"
                            : run.status === "running"
                              ? "secondary"
                              : hasWarnings
                                ? "outline"
                                : "default"
                      }
                    >
                      {run.status === "completed" && hasWarnings ? "partial" : run.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{run.companiesCount ?? "-"}</TableCell>
                  <TableCell>
                    {run.creditsUsed !== null
                      ? `$${run.creditsUsed.toFixed(4)}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {run.completedAt && run.startedAt
                      ? `${Math.round(
                          (new Date(run.completedAt).getTime() -
                            new Date(run.startedAt).getTime()) /
                            1000
                        )}s`
                      : run.status === "running" ? "⏳ running…" : "-"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                    {run.errorMessage
                      ? <span className="text-destructive">{run.errorMessage}</span>
                      : hasWarnings
                        ? <span className="text-yellow-600" title={stepErrors.join("\n")}>⚠ {stepErrors.length} step warning(s)</span>
                        : run.status === "completed"
                          ? <span className="text-green-600">✓ All steps OK</span>
                          : null}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
