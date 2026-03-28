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
  Legend,
} from "recharts";

interface PostsData {
  posts: Array<{
    id: number;
    companyName: string;
    content: string | null;
    postType: string | null;
    likesCount: number | null;
    commentsCount: number | null;
    sharesCount: number | null;
    postedAt: string | null;
    hashtags: string | null;
  }>;
  engagement: Array<{
    companyName: string;
    postCount: number;
    totalLikes: number;
    totalComments: number;
    totalShares: number;
  }>;
  topHashtags: Array<{ tag: string; count: number }>;
}

export default function PostsPage() {
  const { data, loading } = useFetch<PostsData>("/api/dashboard/posts?days=30");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const postsData = data || { posts: [], engagement: [], topHashtags: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Post Activity</h1>
        <p className="text-sm text-muted-foreground">
          LinkedIn post engagement across tracked companies
        </p>
      </div>

      {/* Engagement comparison */}
      <Card className="p-4">
        <h3 className="mb-4 text-sm font-semibold">
          Engagement by Company (Last 30 Days)
        </h3>
        {postsData.engagement.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No post data yet. Run a scrape to collect data.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={postsData.engagement}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="companyName" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Bar dataKey="totalLikes" name="Likes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="totalComments" name="Comments" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="totalShares" name="Shares" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top hashtags */}
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Trending Hashtags</h3>
          {postsData.topHashtags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hashtag data yet</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {postsData.topHashtags.map((h) => (
                <Badge key={h.tag} variant="secondary">
                  {h.tag} ({h.count})
                </Badge>
              ))}
            </div>
          )}
        </Card>

        {/* Post count by company */}
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Posts per Company</h3>
          {postsData.engagement.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet</p>
          ) : (
            <div className="space-y-2">
              {postsData.engagement.map((e) => (
                <div key={e.companyName} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{e.companyName}</span>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 rounded-full bg-blue-500"
                      style={{
                        width: `${Math.min(
                          (e.postCount /
                            Math.max(...postsData.engagement.map((x) => x.postCount))) *
                            120,
                          120
                        )}px`,
                      }}
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {e.postCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent posts timeline */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Recent Posts</h3>
        {postsData.posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts yet</p>
        ) : (
          <div className="space-y-3">
            {postsData.posts.slice(0, 20).map((post) => (
              <div key={post.id} className="border-b pb-3 last:border-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{post.companyName}</span>
                  <span className="text-xs text-muted-foreground">
                    {post.postedAt
                      ? new Date(post.postedAt).toLocaleDateString()
                      : ""}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {post.content}
                </p>
                <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{post.likesCount} likes</span>
                  <span>{post.commentsCount} comments</span>
                  <span>{post.sharesCount} shares</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
