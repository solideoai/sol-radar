import "server-only";
import { z } from "zod";
import { getSupabase } from "@/server/supabase";
import type { WorkforceRepo, CurrentAssignment } from "./workforce.model";
const windows = z
  .array(z.object({ startsAt: z.string(), endsAt: z.string(), fte: z.number().min(0).max(1) }))
  .refine((values) =>
    values.every(
      (w) =>
        Number.isFinite(Date.parse(w.startsAt)) && Date.parse(w.startsAt) < Date.parse(w.endsAt),
    ),
  );

export const workforceRepo: WorkforceRepo = {
  async readBid(_orgId, bidId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("bid_notices")
      .select("id,title,is_demo")
      .eq("id", bidId)
      .maybeSingle();
    if (error) throw error;
    return data ? { bidId: data.id, title: data.title, isDemo: data.is_demo } : null;
  },
  async latestAttempt(orgId, bidId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("score_runs")
      .select("id,status,created_at")
      .eq("org_id", orgId)
      .eq("bid_id", bidId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? { id: data.id, status: data.status, at: data.created_at } : null;
  },
  async scoredSnapshots(orgId, bidId, offset) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("score_runs")
      .select(
        "id,status,input_snapshot,finished_at,revision:bid_revisions!score_runs_revision_fkey(revision)",
      )
      .eq("org_id", orgId)
      .eq("bid_id", bidId)
      .in("status", ["COMPLETED", "PARTIAL"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 19);
    if (error) throw error;
    return data.map((r) => ({
      id: r.id,
      status: r.status === "PARTIAL" ? "PARTIAL" : "COMPLETED",
      revision: r.revision?.revision ?? 0,
      finishedAt: r.finished_at,
      inputSnapshot: r.input_snapshot,
    }));
  },
  async current(orgId, asOf) {
    const db = await getSupabase();
    const [people, scoring] = await Promise.all([
      db
        .from("team_members")
        .select(
          "id,name,is_demo,department:departments!team_members_department_id_org_id_fkey(name),job:job_titles!team_members_job_title_id_org_id_fkey(label)",
        )
        .eq("org_id", orgId)
        .lte("created_at", asOf),
      db
        .from("team_member_scoring")
        .select("member_id,availability")
        .eq("org_id", orgId)
        .lte("created_at", asOf),
    ]);
    if (people.error) throw people.error;
    if (scoring.error) throw scoring.error;
    const assignments: CurrentAssignment[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await db
        .from("assignments")
        .select("id,bid_id,member_id,starts_at,ends_at,allocation_percent")
        .eq("org_id", orgId)
        .lte("created_at", asOf)
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw result.error;
      assignments.push(
        ...result.data.map((r) => ({
          id: r.id,
          bidId: r.bid_id,
          personId: r.member_id,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          allocationPercent: r.allocation_percent,
        })),
      );
      if (result.data.length < 1000) break;
    }
    return {
      people: people.data.map((p) => {
        const parsed = windows.safeParse(
          scoring.data.find((s) => s.member_id === p.id)?.availability,
        );
        return {
          personId: p.id,
          name: p.name,
          isDemo: p.is_demo,
          department: p.department?.name ?? null,
          jobTitle: p.job?.label ?? null,
          availability: parsed.success ? parsed.data : null,
        };
      }),
      assignments,
    };
  },
};
