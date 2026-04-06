"use client";

import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock, Briefcase, Users, ExternalLink, Rss } from "lucide-react";
import Link from "next/link";
import { CATEGORY_META, type PostCategory } from "@/lib/analysis/post-categorizer";
import { AISummary } from "@/components/dashboard/ai-summary";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Post {
  id: number;
  content: string | null;
  likesCount: number | null;
  commentsCount: number | null;
  postedAt: string | null;
  linkedinPostId: string | null;
  category: PostCategory;
}

interface CompanyCard {
  id: number;
  name: string;
  linkedinUrl: string;
  industry: string | null;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  employeeCount: number | null;
  followerCount: number | null;
  activeJobCount: number;
  postCount: number;
  categoryCounts: Record<string, number>;
  posts: Post[];
  gartnerUrl: string | null;
  gartnerInsights: { likes: string[]; dislikes: string[] } | null;
}

interface DigestData {
  period: { from: string; to: string };
  summary: {
    totalCompanies: number;
    companiesWithActivity: number;
    totalActiveJobs: number;
    totalPostsThisWeek: number;
    interestingPostsCount: number;
  };
  companyCards: CompanyCard[];
  lastRun: {
    status: string;
    startedAt: string;
    creditsUsed: number | null;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFollowers(n: number | null | undefined) {
  if (!n) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k followers`;
  return `${n} followers`;
}

function timeSince(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: PostCategory }) {
  const meta = CATEGORY_META[category];
  if (category === "general") return null; // don't show badge for generic posts
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
      {meta.emoji} {meta.label}
    </span>
  );
}

function PostItem({ post }: { post: Post }) {
  const snippet = post.content?.replace(/\s+/g, " ").trim().slice(0, 160);
  const isLong = (post.content?.length ?? 0) > 160;

  return (
    <div className="py-3 border-b last:border-0 space-y-1.5">
      <div className="flex items-center gap-2">
        <CategoryBadge category={post.category} />
        <span className="text-xs text-muted-foreground ml-auto shrink-0">
          {timeSince(post.postedAt)}
        </span>
      </div>
      <p className="text-sm leading-snug text-foreground/85 line-clamp-3">
        {snippet}{isLong ? "…" : ""}
      </p>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>👍 {post.likesCount ?? 0}</span>
        <span>💬 {post.commentsCount ?? 0}</span>
        {post.linkedinPostId && (
          <a
            href={post.linkedinPostId}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-blue-500 hover:underline flex items-center gap-1"
          >
            View <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function CompanyIntelCard({ company }: { company: CompanyCard }) {
  const interestingCategories = Object.entries(company.categoryCounts)
    .filter(([cat]) => cat !== "general" && cat !== "hiring")
    .sort((a, b) => b[1] - a[1]);

  const hasActivity = company.postCount > 0;
  const visiblePosts = company.posts.slice(0, 3);
  const extraPosts = company.postCount - visiblePosts.length;

  const likes = company.gartnerInsights?.likes ?? [];
  const dislikes = company.gartnerInsights?.dislikes ?? [];
  const hasGartner = likes.length > 0 || dislikes.length > 0;
  const totalInsights = likes.length + dislikes.length;

  return (
    <Card className="flex flex-col overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 p-5 pb-4 border-b">
        <div className="flex items-center gap-3 min-w-0">
          {company.logoUrl ? (
            <img
              src={company.logoUrl}
              alt={company.name}
              className="h-11 w-11 rounded-xl object-contain shrink-0 bg-muted p-0.5"
            />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <span className="text-lg font-bold text-muted-foreground">
                {company.name[0].toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link
                href={`/companies/${company.id}`}
                className="font-semibold text-base hover:underline truncate"
              >
                {company.name}
              </Link>
              <a
                href={company.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            {company.industry && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{company.industry}</p>
            )}
          </div>
        </div>
        {/* Stats */}
        <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground shrink-0">
          {company.followerCount != null && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {formatFollowers(company.followerCount)}
            </span>
          )}
          {company.activeJobCount > 0 && (
            <Link
              href={`/companies/${company.id}`}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Briefcase className="h-3 w-3" />
              {company.activeJobCount} jobs
            </Link>
          )}
        </div>
      </div>

      {/* ── Category badges ──────────────────────────────────────────────────── */}
      {interestingCategories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-5 py-2.5 bg-muted/20 border-b">
          <span className="text-xs text-muted-foreground mr-0.5">This week:</span>
          {interestingCategories.map(([cat, count]) => (
            <span
              key={cat}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${CATEGORY_META[cat as PostCategory]?.color ?? ""}`}
            >
              {CATEGORY_META[cat as PostCategory]?.emoji} {count}× {CATEGORY_META[cat as PostCategory]?.label}
            </span>
          ))}
        </div>
      )}

      {/* ── Posts ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 px-5">
        {hasActivity ? (
          <div>
            {visiblePosts.map((post) => (
              <PostItem key={post.id} post={post} />
            ))}
            {extraPosts > 0 && (
              <div className="py-2.5">
                <Link
                  href={`/companies/${company.id}`}
                  className="text-xs text-blue-500 hover:underline"
                >
                  +{extraPosts} more posts →
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Rss className="h-6 w-6 mx-auto mb-2 opacity-30" />
            No posts scraped yet
          </div>
        )}
      </div>

      {/* ── Gartner Peer Insights (compact: 1 like + 1 dislike) ─────────────── */}
      {hasGartner && (
        <div className="px-5 pb-4 pt-3 border-t space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Gartner Peer Insights
            </p>
            {company.gartnerUrl && totalInsights > 2 && (
              <a
                href={company.gartnerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline flex items-center gap-0.5"
              >
                {totalInsights - 2} more <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
          <div className="space-y-2">
            {likes[0] && (
              <div className="flex gap-2">
                <span className="text-green-500 text-xs shrink-0 mt-0.5">👍</span>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {likes[0].length > 140 ? likes[0].slice(0, 140) + "…" : likes[0]}
                </p>
              </div>
            )}
            {dislikes[0] && (
              <div className="flex gap-2">
                <span className="text-amber-500 text-xs shrink-0 mt-0.5">👎</span>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {dislikes[0].length > 140 ? dislikes[0].slice(0, 140) + "…" : dislikes[0]}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({
  summary,
  lastRun,
}: {
  summary: DigestData["summary"];
  lastRun: DigestData["lastRun"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div>
        <h1 className="text-2xl font-bold">Market Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          {summary.companiesWithActivity > 0
            ? `${summary.companiesWithActivity} of ${summary.totalCompanies} companies active this week · ${summary.interestingPostsCount} notable posts`
            : `Tracking ${summary.totalCompanies} companies`}
        </p>
      </div>
      {lastRun && (
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Last updated{" "}
          {new Date(lastRun.startedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data, loading } = useFetch<DigestData>("/api/dashboard/digest");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const digest = data ?? {
    period: { from: "", to: "" },
    summary: { totalCompanies: 0, companiesWithActivity: 0, totalActiveJobs: 0, totalPostsThisWeek: 0, interestingPostsCount: 0 },
    companyCards: [],
    lastRun: null,
  };

  const hasCompanies = digest.companyCards.length > 0;

  return (
    <div className="space-y-6">
      <SummaryBar summary={digest.summary} lastRun={digest.lastRun} />

      {/* AI Weekly Brief — always shown at top when companies exist */}
      {hasCompanies && <AISummary />}

      {!hasCompanies ? (
        <Card className="p-10 text-center text-muted-foreground space-y-3">
          <p className="text-4xl">🔍</p>
          <p className="font-medium">No companies tracked yet</p>
          <p className="text-sm">
            Go to{" "}
            <Link href="/companies" className="text-blue-500 hover:underline">
              Companies
            </Link>{" "}
            and add the cybersecurity companies you want to monitor.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {digest.companyCards.map((company) => (
            <CompanyIntelCard key={company.id} company={company} />
          ))}
        </div>
      )}
    </div>
  );
}
