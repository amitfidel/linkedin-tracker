"use client";

import { useFetch } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Network } from "lucide-react";

interface GraphData {
  nodes: Array<{
    id: number;
    name: string;
    employeeCount: number | null;
    logoUrl: string | null;
  }>;
  edges: Array<{
    source: number;
    target: number;
    type: "shared_employee" | "similar_roles" | "similar_tech";
    weight: number;
    details: string[];
  }>;
}

const edgeColors = {
  shared_employee: "#ef4444",
  similar_roles: "#3b82f6",
  similar_tech: "#10b981",
};

const edgeLabels = {
  shared_employee: "Shared Employees",
  similar_roles: "Similar Roles",
  similar_tech: "Similar Tech Stack",
};

export default function RelationshipsPage() {
  const { data, loading } = useFetch<GraphData>("/api/dashboard/relationships");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const graph = data || { nodes: [], edges: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Company Relationships</h1>
        <p className="text-sm text-muted-foreground">
          Connections between tracked companies based on shared employees,
          similar roles, and tech overlap
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4">
        {Object.entries(edgeLabels).map(([type, label]) => (
          <div key={type} className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: edgeColors[type as keyof typeof edgeColors] }}
            />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {graph.edges.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <Network className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No relationships detected yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Relationships are detected from shared employees, similar job postings,
            and overlapping tech stacks. Run scrapes over time to build connections.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {graph.edges.map((edge, i) => {
            const sourceNode = graph.nodes.find((n) => n.id === edge.source);
            const targetNode = graph.nodes.find((n) => n.id === edge.target);
            if (!sourceNode || !targetNode) return null;

            return (
              <Card key={i} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge
                    style={{
                      backgroundColor: edgeColors[edge.type] + "20",
                      color: edgeColors[edge.type],
                      borderColor: edgeColors[edge.type],
                    }}
                    variant="outline"
                  >
                    {edgeLabels[edge.type]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Strength: {edge.weight}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-3 my-3">
                  <span className="font-medium text-sm">{sourceNode.name}</span>
                  <div
                    className="h-0.5 w-12"
                    style={{ backgroundColor: edgeColors[edge.type] }}
                  />
                  <span className="font-medium text-sm">{targetNode.name}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {edge.details.slice(0, 5).map((detail) => (
                    <Badge key={detail} variant="outline" className="text-xs">
                      {detail}
                    </Badge>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Company nodes overview */}
      {graph.nodes.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Companies in Network</h3>
          <div className="flex flex-wrap gap-3">
            {graph.nodes.map((node) => {
              const connectionCount = graph.edges.filter(
                (e) => e.source === node.id || e.target === node.id
              ).length;
              return (
                <div
                  key={node.id}
                  className="flex items-center gap-2 rounded-lg border p-3"
                >
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
                    {node.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{node.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {connectionCount} connection{connectionCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
