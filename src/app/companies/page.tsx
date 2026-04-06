"use client";

import { useState } from "react";
import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, ExternalLink, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface Company {
  id: number;
  name: string;
  linkedinUrl: string;
  industry: string | null;
  website: string | null;
  employeeCount: number | null;
  headquarters: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function CompaniesPage() {
  const { data: companies, loading, refetch } = useFetch<Company[]>("/api/companies");
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [gartnerUrl, setGartnerUrl] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!name || !linkedinUrl) {
      toast.error("Name and LinkedIn URL are required");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, linkedinUrl, industry: industry || null, gartnerUrl: gartnerUrl || null }),
      });
      if (res.ok) {
        toast.success(`${name} added`);
        setName("");
        setLinkedinUrl("");
        setIndustry("");
        setGartnerUrl("");
        setIsOpen(false);
        refetch();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to add company");
      }
    } catch {
      toast.error("Failed to add company");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: number, companyName: string) {
    if (!confirm(`Delete ${companyName}? This will remove all scraped data.`)) return;
    try {
      const res = await fetch(`/api/companies/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`${companyName} removed`);
        refetch();
      }
    } catch {
      toast.error("Failed to delete");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Manage the cybersecurity companies you're tracking
          </p>
        </div>
        <Button onClick={() => setIsOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Company
        </Button>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Company</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Company Name</Label>
                <Input
                  placeholder="e.g., CrowdStrike"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label>LinkedIn Company URL</Label>
                <Input
                  placeholder="https://linkedin.com/company/crowdstrike"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                />
              </div>
              <div>
                <Label>Industry (optional)</Label>
                <Input
                  placeholder="e.g., Cybersecurity"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                />
              </div>
              <div>
                <Label>Gartner Peer Insights URL (optional)</Label>
                <Input
                  placeholder="https://www.gartner.com/reviews/market/.../vendor/.../likes-dislikes"
                  value={gartnerUrl}
                  onChange={(e) => setGartnerUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave blank — will be auto-discovered on next scrape.
                </p>
              </div>
              <Button onClick={handleAdd} disabled={adding} className="w-full">
                {adding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add Company
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {(!companies || companies.length === 0) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No companies yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Add cybersecurity companies to start tracking their LinkedIn activity.
          </p>
          <Button className="mt-4" onClick={() => setIsOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Your First Company
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {companies.map((company) => (
            <Card key={company.id} className="p-4">
              <div className="flex items-start justify-between">
                <Link
                  href={`/companies/${company.id}`}
                  className="hover:underline"
                >
                  <h3 className="font-semibold">{company.name}</h3>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(company.id, company.name)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 space-y-1">
                {company.industry && (
                  <Badge variant="secondary" className="text-xs">
                    {company.industry}
                  </Badge>
                )}
                {company.employeeCount && (
                  <p className="text-xs text-muted-foreground">
                    {company.employeeCount.toLocaleString()} employees
                  </p>
                )}
                {company.headquarters && (
                  <p className="text-xs text-muted-foreground">
                    {company.headquarters}
                  </p>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <a
                  href={company.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  LinkedIn
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
