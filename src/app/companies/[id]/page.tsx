"use client";

import { use } from "react";
import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { categorizePost, CATEGORY_META, type PostCategory } from "@/lib/analysis/post-categorizer";
import Link from "next/link";

interface CompanyDetail {
  company: {
    id: number;
    name: string;
    linkedinUrl: string;
    industry: string | null;
    description: string | null;
    website: string | null;
    employeeCount: number | null;
    headquarters: string | null;
  };
  recentPosts: Array<{
    id: number;
    content: string | null;
    postType: string | null;
    likesCount: number | null;
    commentsCount: number | null;
    sharesCount: number | null;
    postedAt: string | null;
  }>;
  activeJobs: Array<{
    id: number;
    title: string;
    location: string | null;
    employmentType: string | null;
    seniorityLevel: string | null;
    skills: string | null;
    isActive: boolean;
    scrapedAt: string | null;
  }>;
  personnel: Array<{
    id: number;
    name: string;
    title: string | null;
    isCurrent: boolean;
    lastSeenAt: string | null;
  }>;
  snapshots: Array<{
    employeeCount: number | null;
    followerCount: number | null;
    scrapedAt: string | null;
  }>;
}

export default function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, loading } = useFetch<CompanyDetail>(`/api/companies/${id}`);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center text-muted-foreground">Company not found</div>;
  }

  const { company, recentPosts, activeJobs, personnel, snapshots } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/companies" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{company.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            {company.industry && (
              <Badge variant="secondary">{company.industry}</Badge>
            )}
            {company.employeeCount && (
              <span className="text-sm text-muted-foreground">
                {company.employeeCount.toLocaleString()} employees
              </span>
            )}
            <a
              href={company.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-500 hover:underline flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              LinkedIn
            </a>
          </div>
        </div>
      </div>

      {company.description && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">{company.description}</p>
        </Card>
      )}

      <Tabs defaultValue="posts">
        <TabsList>
          <TabsTrigger value="posts">Posts ({recentPosts.length})</TabsTrigger>
          <TabsTrigger value="jobs">
            Jobs ({activeJobs.filter((j) => j.isActive).length})
          </TabsTrigger>
          <TabsTrigger value="people">
            People ({personnel.filter((p) => p.isCurrent).length})
          </TabsTrigger>
          <TabsTrigger value="history">Growth History</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="mt-4">
          {activeJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs scraped yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Skills</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">{job.title}</TableCell>
                    <TableCell>{job.location || "-"}</TableCell>
                    <TableCell>{job.employmentType || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {job.skills &&
                          (JSON.parse(job.skills) as string[])
                            .slice(0, 3)
                            .map((skill) => (
                              <Badge
                                key={skill}
                                variant="outline"
                                className="text-xs"
                              >
                                {skill}
                              </Badge>
                            ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={job.isActive ? "default" : "secondary"}>
                        {job.isActive ? "Active" : "Closed"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="posts" className="mt-4">
          {recentPosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts scraped yet</p>
          ) : (
            <div className="space-y-3">
              {recentPosts.map((post) => {
                const category = categorizePost(post.content ?? "") as PostCategory;
                const catMeta = CATEGORY_META[category];
                return (
                  <Card key={post.id} className="p-4">
                    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {category !== "general" && (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${catMeta.color}`}>
                            {catMeta.emoji} {catMeta.label}
                          </span>
                        )}
                        {post.postType && (
                          <Badge variant="outline" className="text-xs">{post.postType}</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {post.postedAt
                          ? new Date(post.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : ""}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed">{post.content}</p>
                    <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                      <span>👍 {post.likesCount ?? 0}</span>
                      <span>💬 {post.commentsCount ?? 0}</span>
                      {post.sharesCount != null && <span>🔁 {post.sharesCount}</span>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="people" className="mt-4">
          {personnel.length === 0 ? (
            <p className="text-sm text-muted-foreground">No personnel data yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {personnel.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="font-medium">{person.name}</TableCell>
                    <TableCell>{person.title || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={person.isCurrent ? "default" : "secondary"}>
                        {person.isCurrent ? "Current" : "Former"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {person.lastSeenAt
                        ? new Date(person.lastSeenAt).toLocaleDateString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No growth data yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead>Followers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snap, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      {snap.scrapedAt
                        ? new Date(snap.scrapedAt).toLocaleDateString()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {snap.employeeCount?.toLocaleString() || "-"}
                    </TableCell>
                    <TableCell>
                      {snap.followerCount?.toLocaleString() || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
