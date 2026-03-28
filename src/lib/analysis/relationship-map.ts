import { db } from "@/db";
import { companies, jobListings, keyPersonnel, personnelChanges } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

interface GraphNode {
  id: number;
  name: string;
  employeeCount: number | null;
  logoUrl: string | null;
}

interface GraphEdge {
  source: number;
  target: number;
  type: "shared_employee" | "similar_roles" | "similar_tech";
  weight: number;
  details: string[];
}

export async function buildRelationshipGraph() {
  const activeCompanies = await db
    .select()
    .from(companies)
    .where(eq(companies.isActive, true));

  const nodes: GraphNode[] = activeCompanies.map((c) => ({
    id: c.id,
    name: c.name,
    employeeCount: c.employeeCount,
    logoUrl: c.logoUrl,
  }));

  const edges: GraphEdge[] = [];

  // 1. Shared employees: people who left company A and joined company B
  const allChanges = await db.select().from(personnelChanges);
  const joinsByPerson = new Map<string, number[]>();
  const leftByPerson = new Map<string, number[]>();

  for (const change of allChanges) {
    const name = (change.personName || "").toLowerCase();
    if (change.changeType === "joined") {
      if (!joinsByPerson.has(name)) joinsByPerson.set(name, []);
      joinsByPerson.get(name)!.push(change.companyId);
    }
    if (change.changeType === "left") {
      if (!leftByPerson.has(name)) leftByPerson.set(name, []);
      leftByPerson.get(name)!.push(change.companyId);
    }
  }

  const sharedEmployeeEdges = new Map<string, { details: string[]; weight: number }>();
  for (const [name, leftCompanies] of leftByPerson) {
    const joinedCompanies = joinsByPerson.get(name) || [];
    for (const fromId of leftCompanies) {
      for (const toId of joinedCompanies) {
        if (fromId === toId) continue;
        const key = [Math.min(fromId, toId), Math.max(fromId, toId)].join("-");
        if (!sharedEmployeeEdges.has(key)) {
          sharedEmployeeEdges.set(key, { details: [], weight: 0 });
        }
        const edge = sharedEmployeeEdges.get(key)!;
        edge.weight++;
        edge.details.push(name);
      }
    }
  }

  for (const [key, data] of sharedEmployeeEdges) {
    const [source, target] = key.split("-").map(Number);
    edges.push({
      source,
      target,
      type: "shared_employee",
      weight: data.weight,
      details: data.details,
    });
  }

  // 2. Similar job roles: companies posting same role titles
  const activeJobs = await db
    .select({
      companyId: jobListings.companyId,
      title: jobListings.title,
    })
    .from(jobListings)
    .where(eq(jobListings.isActive, true));

  const jobsByCompany = new Map<number, Set<string>>();
  for (const job of activeJobs) {
    if (!jobsByCompany.has(job.companyId)) {
      jobsByCompany.set(job.companyId, new Set());
    }
    jobsByCompany.get(job.companyId)!.add(normalizeTitle(job.title));
  }

  const companyIds = Array.from(jobsByCompany.keys());
  for (let i = 0; i < companyIds.length; i++) {
    for (let j = i + 1; j < companyIds.length; j++) {
      const titlesA = jobsByCompany.get(companyIds[i])!;
      const titlesB = jobsByCompany.get(companyIds[j])!;
      const shared = [...titlesA].filter((t) => titlesB.has(t));
      if (shared.length >= 2) {
        edges.push({
          source: companyIds[i],
          target: companyIds[j],
          type: "similar_roles",
          weight: shared.length,
          details: shared.slice(0, 5),
        });
      }
    }
  }

  // 3. Similar tech stacks from job skills
  const jobSkills = await db
    .select({
      companyId: jobListings.companyId,
      skills: jobListings.skills,
    })
    .from(jobListings)
    .where(eq(jobListings.isActive, true));

  const skillsByCompany = new Map<number, Map<string, number>>();
  for (const job of jobSkills) {
    if (!job.skills) continue;
    const skills = JSON.parse(job.skills) as string[];
    if (!skillsByCompany.has(job.companyId)) {
      skillsByCompany.set(job.companyId, new Map());
    }
    const map = skillsByCompany.get(job.companyId)!;
    for (const skill of skills) {
      map.set(skill, (map.get(skill) || 0) + 1);
    }
  }

  for (let i = 0; i < companyIds.length; i++) {
    for (let j = i + 1; j < companyIds.length; j++) {
      const skillsA = skillsByCompany.get(companyIds[i]);
      const skillsB = skillsByCompany.get(companyIds[j]);
      if (!skillsA || !skillsB) continue;

      const commonSkills = [...skillsA.keys()].filter((s) => skillsB.has(s));
      if (commonSkills.length >= 5) {
        edges.push({
          source: companyIds[i],
          target: companyIds[j],
          type: "similar_tech",
          weight: commonSkills.length,
          details: commonSkills.slice(0, 5),
        });
      }
    }
  }

  return { nodes, edges };
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(sr|senior|jr|junior|lead|principal|staff)\b/g, "")
    .replace(/\b(i|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
