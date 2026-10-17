import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  pendingPortraits,
  importPortrait,
  markPortraitReady,
  reviewPortrait,
  updatePortrait,
  readPortraitState,
  validatePortraitAssets,
  selectedPortraitFile,
} from "./portraits.mjs";
import { createPortraitGallery } from "./portrait-review.mjs";

const time = "2026-10-16T00:00:00.000Z";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Minimal synthetic PNG header exercises our signature/IHDR contract, never image generation.
function png(seed = 1, width = 2, height = 2) {
  const bytes = Buffer.alloc(34, seed);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
const humanReview = (sha256, verdict = "PASS") => ({
  actor: "human",
  reviewer: "Synthetic test reviewer",
  reviewedAt: time,
  verdict,
  sha256,
  evidence: "Synthetic fixture: human checked suit, one adult, framing, and distinct face.",
});
async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "portrait-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const people = [1, 2, 3].map((index) => ({
    personId: `SOL-P000${index}`,
    gender: index === 3 ? "FEMALE" : "MALE",
    name: index === 1 ? '<가상&"이름>' : "가상인",
    portraitPath: `/demo/people/SOL-P000${index}.png`,
  }));
  const manifest = {
    schemaVersion: "solideo-portraits/v1.0",
    companyName: "솔리데오",
    portraits: people.map((person) => ({
      personId: person.personId,
      gender: person.gender,
      prompt: `Fictional adult Korean ${person.gender === "MALE" ? "man" : "woman"} in suit`,
      status: "PLANNED",
      path: person.portraitPath,
      sha256: null,
      generator: null,
      generatedAt: null,
    })),
  };
  await mkdir(path.join(root, "fixtures/people"), { recursive: true });
  const manifestPath = path.join(root, "fixtures/people/solideo.portraits.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(
    path.join(root, "fixtures/people/solideo.people.json"),
    JSON.stringify({ people }),
  );
  const sourcePath = path.join(root, "tool-selected-output.png");
  await writeFile(sourcePath, png());
  const args = { root, personId: "SOL-P0001", sourcePath, generatedAt: time };
  return { root, people, manifest, manifestPath, sourcePath, args };
}

test("pending queue resumes only PLANNED and FAILED IDs", () => {
  const entries = ["READY", "PLANNED", "FAILED", "GENERATED"].map((status, index) => ({
    personId: `SOL-P000${index + 1}`,
    gender: "MALE",
    prompt: "Fictional adult in suit",
    status,
  }));
  assert.deepEqual(pendingPortraits(entries), [
    { personId: "SOL-P0002", gender: "MALE", prompt: "Fictional adult in suit" },
    { personId: "SOL-P0003", gender: "MALE", prompt: "Fictional adult in suit" },
  ]);
});

test("imports selected PNG to fixed path and persists resumable generated metadata", async (t) => {
  const { root, args, people, sourcePath } = await setup(t);
  const result = await importPortrait(args);
  assert.deepEqual(result, {
    path: "/demo/people/SOL-P0001.png",
    sha256: digest(png()),
    status: "GENERATED",
  });
  assert.deepEqual(await readFile(path.join(root, "web/public", result.path)), png());
  const { manifest } = await readPortraitState({ root });
  assert.equal(manifest.portraits[0].status, "GENERATED");
  assert.equal(manifest.portraits[0].generator, "imagegen");
  assert.equal(JSON.stringify(manifest).includes(sourcePath), false);
  assert.deepEqual(
    pendingPortraits(manifest).map((entry) => entry.personId),
    ["SOL-P0002", "SOL-P0003"],
  );
  assert.deepEqual(
    await validatePortraitAssets(people, manifest, { root, requireReady: false }),
    [],
  );
});

for (const [label, bytes, code] of [
  ["non-PNG", Buffer.from("not png"), "INVALID_PNG"],
  ["rectangle", png(1, 2, 3), "NOT_SQUARE"],
  ["zero dimensions", png(1, 0, 0), "INVALID_PNG"],
  [
    "wrong IHDR",
    (() => {
      const bytes = png();
      bytes.write("IDAT", 12);
      return bytes;
    })(),
    "INVALID_PNG",
  ],
]) {
  test(`rejects ${label} and records FAILED for retry`, async (t) => {
    const { root, args, sourcePath } = await setup(t);
    await writeFile(sourcePath, bytes);
    await assert.rejects(importPortrait(args), { code });
    const { manifest } = await readPortraitState({ root });
    assert.equal(manifest.portraits[0].status, "FAILED");
    assert.equal(manifest.portraits[0].failure, code);
  });
}

test("rejects identical PNG bytes for another person", async (t) => {
  const { args } = await setup(t);
  await importPortrait(args);
  await assert.rejects(importPortrait({ ...args, personId: "SOL-P0002" }), {
    code: "DUPLICATE_IMAGE",
  });
});

for (const [field, value, code] of [
  ["gender", "FEMALE", "GENDER_MISMATCH"],
  ["path", "/demo/people/../../secret.png", "INVALID_PATH"],
]) {
  test(`refuses manifest ${field} drift before file mutation`, async (t) => {
    const { args, manifest, manifestPath } = await setup(t);
    manifest.portraits[0][field] = value;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(importPortrait(args), { code });
  });
}

test("only documented human PASS for the current hash can promote READY", async (t) => {
  const { root, args } = await setup(t);
  const result = await importPortrait(args);
  for (const review of [
    undefined,
    { ...humanReview(result.sha256), actor: "ai" },
    { ...humanReview(result.sha256), evidence: "" },
    humanReview("a".repeat(64)),
  ])
    await assert.rejects(markPortraitReady({ root, personId: args.personId, review }), {
      code: "HUMAN_REVIEW_REQUIRED",
    });
  await reviewPortrait({
    root,
    personId: args.personId,
    review: {
      ...humanReview(result.sha256),
      actor: "ai",
      reviewer: "AI visual inspection",
    },
  });
  assert.equal((await readPortraitState({ root })).manifest.portraits[0].status, "GENERATED");
  await markPortraitReady({ root, personId: args.personId, review: humanReview(result.sha256) });
  const portrait = (await readPortraitState({ root })).manifest.portraits[0];
  assert.equal(portrait.status, "READY");
  assert.equal(portrait.review.actor, "human");
});

test("READY replacement preserves prior bytes and metadata through failure/rejection then promotes candidate", async (t) => {
  const { root, args, sourcePath } = await setup(t);
  const first = await importPortrait(args);
  await markPortraitReady({ root, personId: args.personId, review: humanReview(first.sha256) });
  const original = (await readPortraitState({ root })).manifest.portraits[0];
  await assert.rejects(importPortrait(args), { code: "READY_REPLACEMENT_REQUIRED" });
  await writeFile(sourcePath, Buffer.from("broken"));
  await assert.rejects(importPortrait({ ...args, replace: true }), { code: "INVALID_PNG" });
  assert.deepEqual((await readPortraitState({ root })).manifest.portraits[0], original);
  await writeFile(sourcePath, png(2));
  const second = await importPortrait({ ...args, replace: true });
  let portrait = (await readPortraitState({ root })).manifest.portraits[0];
  assert.equal(portrait.status, "READY");
  assert.equal(portrait.sha256, first.sha256);
  assert.equal(portrait.candidate.sha256, second.sha256);
  assert.equal(JSON.stringify(portrait).includes(sourcePath), false);
  const finalPath = path.join(root, "web/public", first.path);
  assert.deepEqual(await readFile(finalPath), png());
  await reviewPortrait({
    root,
    personId: args.personId,
    review: humanReview(second.sha256, "REGENERATE"),
  });
  portrait = (await readPortraitState({ root })).manifest.portraits[0];
  assert.equal(portrait.candidate.status, "FAILED");
  assert.equal(portrait.sha256, first.sha256);
  assert.deepEqual(await readFile(finalPath), png());
  await importPortrait({ ...args, replace: true });
  await markPortraitReady({ root, personId: args.personId, review: humanReview(second.sha256) });
  portrait = (await readPortraitState({ root })).manifest.portraits[0];
  assert.equal(portrait.candidate, undefined);
  assert.equal(portrait.sha256, second.sha256);
  assert.deepEqual(await readFile(finalPath), png(2));
});

test("tampered generated file cannot be marked READY", async (t) => {
  const { root, args } = await setup(t);
  const result = await importPortrait(args);
  await writeFile(path.join(root, "web/public", result.path), png(9));
  await assert.rejects(
    markPortraitReady({ root, personId: args.personId, review: humanReview(result.sha256) }),
    { code: "HASH_MISMATCH" },
  );
});

test("failed generation and prompt changes resume without allowing manual READY", async (t) => {
  const { root, args } = await setup(t);
  await updatePortrait({
    root,
    personId: args.personId,
    prompt: "Fictional adult man, gray suit",
    status: "FAILED",
    failure: "GENERATION_INTERRUPTED",
  });
  let portrait = (await readPortraitState({ root })).manifest.portraits[0];
  assert.equal(portrait.prompt, "Fictional adult man, gray suit");
  assert.equal(portrait.status, "FAILED");
  await assert.rejects(updatePortrait({ root, personId: args.personId, status: "READY" }), {
    code: "INVALID_TRANSITION",
  });
  await importPortrait(args);
  await reviewPortrait({
    root,
    personId: args.personId,
    review: humanReview(digest(png()), "REGENERATE"),
  });
  portrait = (await readPortraitState({ root })).manifest.portraits[0];
  assert.equal(portrait.status, "FAILED");
  assert.ok(pendingPortraits([portrait]).length);
});

test("asset validation catches gender/path/hash/duplicate and fabricated review", async (t) => {
  const { root, args, people } = await setup(t);
  await importPortrait(args);
  const { manifest } = await readPortraitState({ root });
  manifest.portraits[0].status = "READY";
  manifest.portraits[1].sha256 = manifest.portraits[0].sha256;
  manifest.portraits[1].gender = "FEMALE";
  manifest.portraits[2].path = "/../escape";
  const codes = (await validatePortraitAssets(people, manifest, { root, requireReady: false })).map(
    (error) => error.code,
  );
  for (const code of [
    "HUMAN_REVIEW_REQUIRED",
    "DUPLICATE_IMAGE",
    "GENDER_MISMATCH",
    "INVALID_PATH",
  ])
    assert.ok(codes.includes(code), code);
});

test("gallery uses selected actual candidate image outside repo and escapes names", async (t) => {
  const { root, args, sourcePath } = await setup(t);
  const first = await importPortrait(args);
  await markPortraitReady({ root, personId: args.personId, review: humanReview(first.sha256) });
  await writeFile(sourcePath, png(2));
  await importPortrait({ ...args, replace: true });
  const galleryPath = await createPortraitGallery({ root });
  t.after(() => rm(path.dirname(galleryPath), { recursive: true, force: true }));
  assert.equal(galleryPath.startsWith(root + path.sep), false);
  const html = await readFile(galleryPath, "utf8");
  assert.ok(html.includes("&lt;가상&amp;&quot;이름&gt;"));
  assert.ok(html.includes(digest(png(2))));
  const portrait = (await readPortraitState({ root })).manifest.portraits[0];
  const selected = await selectedPortraitFile(portrait, { root });
  assert.ok(html.includes(pathToFileURL(selected).href));
  assert.deepEqual(await readFile(selected), png(2));
  assert.equal(html.includes(args.sourcePath), false);
});

test("CLI supports pending, JSON prompt/status update, import, review and reports safe failures", async (t) => {
  const { root, args, sourcePath } = await setup(t);
  const run = (...parts) =>
    spawnSync(process.execPath, ["scripts/people/portraits.mjs", ...parts, "--root", root], {
      encoding: "utf8",
    });
  assert.equal(JSON.parse(run("pending").stdout).length, 3);
  const input = path.join(root, "update.json");
  await writeFile(
    input,
    JSON.stringify({
      personId: args.personId,
      prompt: "Fictional adult in suit",
      status: "FAILED",
      failure: "INTERRUPTED",
    }),
  );
  assert.equal(run("update", "--input", input).status, 0);
  const imported = run(
    "import",
    "--person",
    args.personId,
    "--source",
    sourcePath,
    "--generated-at",
    time,
  );
  assert.equal(imported.status, 0, imported.stderr);
  const result = JSON.parse(imported.stdout);
  await writeFile(
    input,
    JSON.stringify({ personId: args.personId, review: humanReview(result.sha256) }),
  );
  assert.equal(run("review", "--input", input).status, 0);
  assert.equal(JSON.parse(run("status").stdout).counts.READY, 1);
  const failure = run("import", "--person", "../secret", "--source", "/private/source");
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout.includes("/private"), false);
  assert.equal(failure.stderr, "");
});

test("generated replacement prompt cannot change without marking candidate failed", async (t) => {
  const { root, args, sourcePath } = await setup(t);
  const first = await importPortrait(args);
  await markPortraitReady({ root, personId: args.personId, review: humanReview(first.sha256) });
  await writeFile(sourcePath, png(2));
  await importPortrait({ ...args, replace: true });
  await assert.rejects(
    updatePortrait({ root, personId: args.personId, replace: true, prompt: "Changed prompt" }),
    { code: "INVALID_TRANSITION" },
  );
});

test("fixture validator rejects malformed replacement lifecycle and AI READY candidate", async (t) => {
  const { root, args, people } = await setup(t);
  const first = await importPortrait(args);
  await markPortraitReady({ root, personId: args.personId, review: humanReview(first.sha256) });
  const { manifest } = await readPortraitState({ root });
  manifest.portraits[0].candidate = {
    status: "READY",
    sha256: "b".repeat(64),
    review: { actor: "ai", verdict: "PASS" },
  };
  const errors = await validatePortraitAssets(people, manifest, { root, requireReady: false });
  assert.ok(errors.some((error) => error.code === "PORTRAIT_MANIFEST_INVALID"));
});

test("direct asset validator fails closed for malformed envelopes and null records", async () => {
  for (const manifest of [null, {}, { portraits: [null] }]) {
    const errors = await validatePortraitAssets([], manifest);
    assert.ok(errors.some((error) => error.code === "PORTRAIT_MANIFEST_INVALID"));
  }
});

test("missing tool output records retryable failure without its source path", async (t) => {
  const { root, args } = await setup(t);
  await assert.rejects(
    importPortrait({ ...args, sourcePath: "/private/synthetic-missing-tool.png" }),
    { code: "ENOENT" },
  );
  const { manifest } = await readPortraitState({ root });
  assert.equal(manifest.portraits[0].status, "FAILED");
  assert.equal(JSON.stringify(manifest).includes("/private"), false);
});

test("fixed destination rejects symlink escape without touching outside directory", async (t) => {
  const { root, args } = await setup(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "portrait-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(root, "web/public/demo"), { recursive: true });
  await symlink(outside, path.join(root, "web/public/demo/people"));
  await assert.rejects(importPortrait(args), { code: "INVALID_PATH" });
  await assert.rejects(readFile(path.join(outside, "SOL-P0001.png")), { code: "ENOENT" });
});

test("busy writer refuses changes and dead writer lock permits retry", async (t) => {
  const { root, args, manifestPath } = await setup(t);
  await writeFile(manifestPath + ".lock", String(process.pid));
  await assert.rejects(importPortrait(args), { code: "PORTRAIT_STORE_BUSY" });
  assert.equal((await readPortraitState({ root })).manifest.portraits[0].status, "PLANNED");
  await writeFile(manifestPath + ".lock", "2147483647");
  assert.equal((await importPortrait(args)).status, "GENERATED");
});

test("reimport does not erase a generated image awaiting human review", async (t) => {
  const { root, args, sourcePath } = await setup(t);
  await importPortrait(args);
  await writeFile(sourcePath, png(2));
  await assert.rejects(importPortrait(args), { code: "INVALID_TRANSITION" });
  assert.deepEqual(await readFile(path.join(root, "web/public/demo/people/SOL-P0001.png")), png());
});
