"use server";
import { notFound } from "next/navigation";
import { requireCurrentOrganization } from "@/app/(app)/employment-guard";
import type { CreateTeamResult } from "@/server/organization";
export async function create(_input: unknown): Promise<CreateTeamResult> {
  void _input;
  if (!(await requireCurrentOrganization("/dashboard"))) return { status: "signed-out" };
  notFound();
}
