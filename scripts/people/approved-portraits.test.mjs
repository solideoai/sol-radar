import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validatePortraitAssets } from "./portraits.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => readFile(path.join(root, file));
const json = async (file) => JSON.parse(await read(file));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const approval = await json("docs/evidence/people/20261017-portraits-approval.json");
const manifest = await json("fixtures/people/solideo.portraits.json");
const roster = await json("fixtures/people/solideo.people.json");

test("human approval binds the exact roster, catalogs, fixed paths and all 200 actual PNG hashes", async () => {
  assert.equal(approval.status, "APPROVED");
  assert.equal(approval.actor, "human");
  assert.equal(approval.approvalStatement, "사진 200장 전체를 최종 승인합니다.");
  assert.ok(Number.isFinite(Date.parse(approval.recordedAt)));
  assert.deepEqual(approval.counts, {
    total: 200,
    automaticPass: 200,
    automaticFail: 0,
    humanApproved: 200,
  });
  assert.equal(
    approval.snapshotSha256,
    "19cbd9408e9672273db9405073dde5f9133d7715fa40041e51b91c824e8ff0e1",
  );
  assert.equal(sha256(JSON.stringify(approval.snapshot)), approval.snapshotSha256);
  assert.equal(roster.people.length, 200);
  assert.equal(manifest.portraits.length, 200);
  const departments = (await json("fixtures/people/solideo.departments.json")).departments;
  const titles = (await json("fixtures/people/solideo.job-titles.json")).jobTitles;
  const bindings = await Promise.all(
    roster.people.map(async (person, index) => {
      const portrait = manifest.portraits[index];
      assert.equal(person.personId, `SOL-P${String(index + 1).padStart(4, "0")}`);
      assert.equal(portrait.personId, person.personId);
      assert.equal(portrait.gender, person.gender);
      assert.equal(portrait.path, `/demo/people/${person.personId}.png`);
      assert.equal(portrait.path, person.portraitPath);
      assert.equal(portrait.status, "READY");
      assert.equal(portrait.review.actor, "human");
      assert.equal(portrait.review.verdict, "PASS");
      assert.equal(portrait.review.sha256, portrait.sha256);
      assert.equal(portrait.review.reviewedAt, approval.recordedAt);
      assert.equal(portrait.candidate, undefined);
      assert.equal(sha256(await read(`web/public${portrait.path}`)), portrait.sha256);
      return {
        personId: person.personId,
        name: person.name,
        gender: person.gender,
        departmentId: person.departmentId,
        department: departments.find((d) => d.id === person.departmentId).name,
        jobTitleId: person.jobTitleId,
        jobTitle: titles.find((t) => t.id === person.jobTitleId).label,
        portraitPath: person.portraitPath,
        sha256: portrait.sha256,
      };
    }),
  );
  assert.deepEqual(bindings, approval.snapshot);
  assert.equal(new Set(bindings.map((binding) => binding.sha256)).size, 200);
  assert.deepEqual(
    (await readdir(path.join(root, "web/public/demo/people"))).sort(),
    roster.people.map((person) => `${person.personId}.png`).sort(),
  );
  assert.deepEqual(await validatePortraitAssets(roster.people, manifest, { root }), []);
});

test("prior AI reviews and historical pending audit remain separate from human approval", async () => {
  const previous = approval.previousAiReviewEvidence;
  assert.equal(sha256(await read(previous.path)), previous.sha256);
  const aiEvidence = await json(previous.path);
  assert.equal(aiEvidence.stage, "GENERATED_AWAITING_HUMAN_REVIEW");
  assert.equal(aiEvidence.humanApproval.status, "pending");
  assert.equal(approval.historicalAudit.humanApprovalState, "PENDING");
  assert.equal(approval.historicalAudit.approvalRecorded, false);
  assert.equal(approval.historicalAudit.summary.automaticPass, 200);
  assert.equal(approval.historicalAudit.summary.automaticFail, 0);
  assert.equal(approval.previousAiReviews.length, 200);
  for (const [index, prior] of approval.previousAiReviews.entries()) {
    const portrait = manifest.portraits[index];
    assert.equal(prior.personId, portrait.personId);
    assert.equal(prior.review.actor, "ai");
    assert.equal(prior.review.verdict, "PASS");
    assert.equal(prior.review.sha256, portrait.sha256);
    assert.deepEqual(prior.review, aiEvidence.portraits[index].review);
  }
});
