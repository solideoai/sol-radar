import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const manifestName = "fixtures/people/solideo.portraits.json";
const personPattern = /^SOL-P(?:00(?:0[1-9]|[1-9]\d)|01\d\d|0200)$/;
const hashPattern = /^[a-f0-9]{64}$/;
const statuses = ["PLANNED", "GENERATED", "READY", "FAILED"];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && !!value.trim();
const validTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const entries = (manifest) => (Array.isArray(manifest) ? manifest : manifest?.portraits);
const problem = (code) => Object.assign(new Error(code), { code });

function fixedPath(personId) {
  if (!personPattern.test(personId)) throw problem("INVALID_PERSON_ID");
  return `/demo/people/${personId}.png`;
}

/** Only the generated header contract is checked; human review still checks image content. */
export function inspectPortraitPng(bytes) {
  if (
    bytes.length < 33 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
    bytes.readUInt32BE(16) <= 0 ||
    bytes.readUInt32BE(20) <= 0
  )
    throw problem("INVALID_PNG");
  if (bytes.readUInt32BE(16) !== bytes.readUInt32BE(20)) throw problem("NOT_SQUARE");
  return { sha256: sha256(bytes) };
}

function metadataValid(portrait) {
  return (
    nonempty(portrait.prompt) &&
    nonempty(portrait.generator) &&
    validTime(portrait.generatedAt) &&
    hashPattern.test(portrait.sha256 ?? "")
  );
}

export function validPortraitReview(review, hash, { human = false } = {}) {
  return (
    isRecord(review) &&
    ["human", "ai"].includes(review.actor) &&
    (!human || review.actor === "human") &&
    nonempty(review.reviewer) &&
    validTime(review.reviewedAt) &&
    nonempty(review.evidence) &&
    ["PASS", "REGENERATE"].includes(review.verdict) &&
    hashPattern.test(hash ?? "") &&
    review.sha256 === hash
  );
}

function humanPass(portrait) {
  return (
    validPortraitReview(portrait.review, portrait.sha256, { human: true }) &&
    portrait.review.verdict === "PASS"
  );
}

export function pendingPortraits(manifest) {
  return entries(manifest)
    .filter((portrait) => ["PLANNED", "FAILED"].includes(portrait.status))
    .map(({ personId, gender, prompt }) => ({ personId, gender, prompt }));
}

export async function readPortraitState({ root = ROOT } = {}) {
  const [people, manifest] = await Promise.all([
    readFile(path.join(root, "fixtures/people/solideo.people.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, manifestName), "utf8").then(JSON.parse),
  ]);
  if (
    !Array.isArray(people.people) ||
    !isRecord(manifest) ||
    manifest.schemaVersion !== "solideo-portraits/v1.0" ||
    manifest.companyName !== "솔리데오" ||
    !Array.isArray(manifest.portraits)
  )
    throw problem("PORTRAIT_MANIFEST_INVALID");
  return { people: people.people, manifest };
}

function selectPortrait(people, manifest, personId) {
  const expected = fixedPath(personId);
  const person = people.find((person) => person.personId === personId);
  const matches = entries(manifest).filter((portrait) => portrait?.personId === personId);
  if (!person || matches.length !== 1) throw problem("PORTRAIT_MANIFEST_INVALID");
  const portrait = matches[0];
  if (portrait.gender !== person.gender || !["MALE", "FEMALE"].includes(person.gender))
    throw problem("GENDER_MISMATCH");
  if (portrait.path !== expected || person.portraitPath !== expected) throw problem("INVALID_PATH");
  return portrait;
}

async function assetFile(root, portrait, { create = false } = {}) {
  root = await realpath(root);
  const expected = fixedPath(portrait.personId);
  if (portrait.path !== expected) throw problem("INVALID_PATH");
  const filename = path.join(root, "web/public", expected);
  const directory = path.dirname(filename);
  if (create) await mkdir(directory, { recursive: true });
  // A fixed lexical path must not escape through a symlink either.
  if ((await realpath(directory)) !== path.resolve(directory)) throw problem("INVALID_PATH");
  try {
    if ((await lstat(filename)).isSymbolicLink()) throw problem("INVALID_PATH");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return filename;
}

async function candidateFile(root, portrait) {
  fixedPath(portrait.personId);
  if (!hashPattern.test(portrait.candidate?.sha256 ?? "")) throw problem("HASH_MISMATCH");
  const directory = path.join(
    await realpath(os.tmpdir()),
    "solideo-portrait-candidates",
    sha256(Buffer.from(await realpath(root))),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await realpath(directory)) !== path.resolve(directory)) throw problem("INVALID_PATH");
  return path.join(directory, `${portrait.personId}-${portrait.candidate.sha256}.png`);
}

/** Gallery and review share the same selected candidate; no cache path is stored in JSON. */
export async function selectedPortraitFile(portrait, { root = ROOT } = {}) {
  if (portrait.candidate?.status === "GENERATED") return candidateFile(root, portrait);
  return assetFile(root, portrait);
}

async function atomicWrite(filename, bytes) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function save(root, manifest) {
  await atomicWrite(path.join(root, manifestName), JSON.stringify(manifest, null, 2) + "\n");
}

// Reject concurrent writers instead of losing updates. A dead writer's PID permits resumption.
async function mutate(root, operation) {
  root = await realpath(root);
  const lockPath = path.join(root, manifestName + ".lock");
  let lock;
  try {
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await readFile(lockPath, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw problem("PORTRAIT_STORE_BUSY");
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          await rm(lockPath);
          lock = await open(lockPath, "wx");
        } else throw problem("PORTRAIT_STORE_BUSY");
      }
      if (!lock) throw problem("PORTRAIT_STORE_BUSY");
    }
    await lock.writeFile(String(process.pid));
    return await operation(await readPortraitState({ root }), root);
  } finally {
    if (lock) {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}

function assertUnique(manifest, hash, personId) {
  if (
    entries(manifest).some(
      (entry) =>
        entry.personId !== personId && (entry.sha256 === hash || entry.candidate?.sha256 === hash),
    )
  )
    throw problem("DUPLICATE_IMAGE");
}

export async function importPortrait({
  personId,
  sourcePath,
  generatedAt,
  replace = false,
  root = ROOT,
}) {
  return mutate(root, async ({ people, manifest }, root) => {
    const portrait = selectPortrait(people, manifest, personId);
    if (portrait.status === "READY" && !replace) throw problem("READY_REPLACEMENT_REQUIRED");
    if (portrait.status === "GENERATED" || portrait.candidate?.status === "GENERATED")
      throw problem("INVALID_TRANSITION");
    try {
      if (!validTime(generatedAt) || !nonempty(portrait.prompt))
        throw problem("PORTRAIT_METADATA_INCOMPLETE");
      const bytes = await readFile(sourcePath);
      const { sha256: hash } = inspectPortraitPng(bytes);
      assertUnique(manifest, hash, personId);
      const metadata = {
        prompt: portrait.candidate?.prompt ?? portrait.prompt,
        sha256: hash,
        generator: "imagegen",
        generatedAt,
        status: "GENERATED",
      };
      if (portrait.status === "READY") {
        if (hash === portrait.sha256) throw problem("DUPLICATE_IMAGE");
        portrait.candidate = metadata;
        await atomicWrite(await candidateFile(root, portrait), bytes);
      } else {
        await atomicWrite(await assetFile(root, portrait, { create: true }), bytes);
        Object.assign(portrait, metadata);
        delete portrait.review;
        delete portrait.failure;
      }
      await save(root, manifest);
      return { path: portrait.path, sha256: hash, status: "GENERATED" };
    } catch (error) {
      // A failed replacement never changes the previous READY record or bytes.
      if (portrait.status !== "READY") {
        portrait.status = "FAILED";
        portrait.failure = safeCode(error);
        await save(root, manifest);
      }
      throw error;
    }
  });
}

/** Prompt updates and interrupted attempts cannot manufacture GENERATED or READY. */
export async function updatePortrait({
  personId,
  prompt,
  status,
  failure,
  replace = false,
  root = ROOT,
}) {
  return mutate(root, async ({ people, manifest }, root) => {
    const portrait = selectPortrait(people, manifest, personId);
    if (status !== undefined && !["PLANNED", "FAILED"].includes(status))
      throw problem("INVALID_TRANSITION");
    if (prompt !== undefined && !nonempty(prompt)) throw problem("PORTRAIT_METADATA_INCOMPLETE");
    let target = portrait;
    if (portrait.status === "READY") {
      if (!replace) throw problem("READY_REPLACEMENT_REQUIRED");
      target = portrait.candidate ??= { prompt: portrait.prompt, status: "PLANNED" };
    }
    if (target.status === "GENERATED" && status !== "FAILED") throw problem("INVALID_TRANSITION");
    if (prompt !== undefined) target.prompt = prompt;
    if (status !== undefined) target.status = status;
    if (status === "FAILED")
      target.failure = /^[A-Z][A-Z0-9_]{1,79}$/.test(failure ?? "") ? failure : "GENERATION_FAILED";
    if (status === "PLANNED") delete target.failure;
    await save(root, manifest);
  });
}

export async function reviewPortrait({ personId, review, root = ROOT }) {
  return mutate(root, async ({ people, manifest }, root) => {
    const portrait = selectPortrait(people, manifest, personId);
    const candidate = portrait.candidate?.status === "GENERATED" ? portrait.candidate : null;
    const target = candidate ?? portrait;
    if (target.status !== "GENERATED") throw problem("INVALID_TRANSITION");
    if (!validPortraitReview(review, target.sha256)) throw problem("HUMAN_REVIEW_REQUIRED");
    const filename = await selectedPortraitFile(portrait, { root });
    const bytes = await readFile(filename);
    if (inspectPortraitPng(bytes).sha256 !== target.sha256) throw problem("HASH_MISMATCH");
    assertUnique(manifest, target.sha256, personId);
    const previous = structuredClone(portrait);
    target.review = structuredClone(review);
    if (review.verdict === "REGENERATE") {
      target.status = "FAILED";
      target.failure = "REVIEW_REGENERATE";
    } else if (review.actor === "human") target.status = "READY";
    let oldBytes;
    let finalPath;
    if (candidate && target.status === "READY") {
      finalPath = await assetFile(root, portrait);
      oldBytes = await readFile(finalPath);
      await atomicWrite(finalPath, bytes);
      Object.assign(portrait, candidate);
      delete portrait.candidate;
    }
    try {
      await save(root, manifest);
    } catch (error) {
      if (oldBytes) await atomicWrite(finalPath, oldBytes);
      Object.assign(portrait, previous);
      throw error;
    }
  });
}

export async function markPortraitReady({ personId, review, root = ROOT }) {
  if (!validPortraitReview(review, review?.sha256, { human: true }) || review.verdict !== "PASS")
    throw problem("HUMAN_REVIEW_REQUIRED");
  return reviewPortrait({ personId, review, root });
}

/** Stage-aware shared checker: lifecycle and identity always, release files when requested. */
export async function validatePortraitAssets(
  people,
  manifest,
  { root = ROOT, requireReady = true, checkFiles = true } = {},
) {
  const errors = [];
  const add = (code, personId) => {
    const item = personPattern.test(personId ?? "") ? { code, personId } : { code };
    if (!errors.some((error) => error.code === code && error.personId === item.personId))
      errors.push(item);
  };
  const portraits = entries(manifest);
  if (
    !Array.isArray(people) ||
    people.some((person) => !isRecord(person)) ||
    !Array.isArray(portraits) ||
    portraits.some((portrait) => !isRecord(portrait))
  ) {
    add("PORTRAIT_MANIFEST_INVALID");
    return errors;
  }
  if (portraits.length !== people.length) add("PORTRAIT_MANIFEST_INVALID");
  if (
    requireReady &&
    portraits.some((portrait) => portrait.status !== "READY" || !humanPass(portrait))
  )
    add("PORTRAITS_INCOMPLETE");
  const hashes = new Set();
  for (const [index, portrait] of portraits.entries()) {
    const personId = portrait?.personId;
    if (!isRecord(portrait)) {
      add("PORTRAIT_MANIFEST_INVALID");
      continue;
    }
    try {
      selectPortrait(people, manifest, personId);
      if (people[index]?.personId !== personId) add("PORTRAIT_MANIFEST_INVALID", personId);
    } catch (error) {
      add(safeCode(error), personId);
    }
    if (
      !statuses.includes(portrait.status) ||
      typeof portrait.prompt !== "string" ||
      !(
        portrait.sha256 === null ||
        (typeof portrait.sha256 === "string" && hashPattern.test(portrait.sha256))
      ) ||
      !(portrait.generator === null || typeof portrait.generator === "string") ||
      !(portrait.generatedAt === null || validTime(portrait.generatedAt))
    )
      add("PORTRAIT_MANIFEST_INVALID", personId);
    if (portrait.candidate !== undefined) {
      const candidate = portrait.candidate;
      if (
        portrait.status !== "READY" ||
        !isRecord(candidate) ||
        !["PLANNED", "GENERATED", "FAILED"].includes(candidate.status) ||
        !nonempty(candidate.prompt)
      ) {
        add("PORTRAIT_MANIFEST_INVALID", personId);
      } else {
        if (candidate.status === "GENERATED" && !metadataValid(candidate))
          add("PORTRAIT_METADATA_INCOMPLETE", personId);
        if (candidate.review && !validPortraitReview(candidate.review, candidate.sha256))
          add("HUMAN_REVIEW_REQUIRED", personId);
        if (checkFiles && candidate.status === "GENERATED") {
          try {
            const bytes = await readFile(await candidateFile(root, portrait));
            if (inspectPortraitPng(bytes).sha256 !== candidate.sha256)
              add("HASH_MISMATCH", personId);
          } catch {
            add("PORTRAIT_FILE_INVALID", personId);
          }
        }
      }
    }
    for (const hash of [portrait.sha256, portrait.candidate?.sha256].filter(Boolean)) {
      if (hashes.has(hash)) add("DUPLICATE_IMAGE", personId);
      hashes.add(hash);
    }
    if (!["GENERATED", "READY"].includes(portrait.status)) continue;
    if (!metadataValid(portrait)) add("PORTRAIT_METADATA_INCOMPLETE", personId);
    if (portrait.status === "READY" && !humanPass(portrait)) add("HUMAN_REVIEW_REQUIRED", personId);
    if (portrait.review && !validPortraitReview(portrait.review, portrait.sha256))
      add("HUMAN_REVIEW_REQUIRED", personId);
    if (checkFiles) {
      try {
        const bytes = await readFile(await assetFile(root, portrait));
        if (inspectPortraitPng(bytes).sha256 !== portrait.sha256) add("HASH_MISMATCH", personId);
      } catch (error) {
        add(
          safeCode(error) === "INVALID_PATH" ? "INVALID_PATH" : "PORTRAIT_FILE_INVALID",
          personId,
        );
      }
    }
  }
  return errors;
}

function safeCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(code)
    ? code
    : "PORTRAIT_OPERATION_FAILED";
}

function parseArgs(args) {
  const [command, ...rest] = args.filter((arg) => arg !== "--");
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (key === "--replace") options.replace = true;
    else if (
      ["--root", "--person", "--source", "--generated-at", "--input"].includes(key) &&
      rest[index + 1] &&
      !rest[index + 1].startsWith("--")
    )
      options[key.slice(2)] = rest[++index];
    else throw problem("INVALID_ARGUMENTS");
  }
  return { command, options };
}

async function cli(args) {
  const { command, options } = parseArgs(args);
  const root = options.root ?? ROOT;
  if (["pending", "status"].includes(command)) {
    const { manifest } = await readPortraitState({ root });
    if (command === "pending") return pendingPortraits(manifest);
    return {
      counts: Object.fromEntries(
        statuses.map((status) => [
          status,
          manifest.portraits.filter((entry) => entry.status === status).length,
        ]),
      ),
      portraits: manifest.portraits.map(
        ({ personId, gender, status, sha256, candidate, failure }) => ({
          personId,
          gender,
          status,
          sha256,
          ...(candidate ? { candidate } : {}),
          ...(failure ? { failure } : {}),
        }),
      ),
    };
  }
  if (command === "import")
    return importPortrait({
      root,
      personId: options.person,
      sourcePath: options.source,
      generatedAt: options["generated-at"],
      replace: options.replace,
    });
  if (["update", "review"].includes(command) && options.input) {
    const payload = JSON.parse(await readFile(options.input, "utf8"));
    if (!isRecord(payload)) throw problem("INVALID_ARGUMENTS");
    if (command === "update")
      await updatePortrait({
        personId: payload.personId,
        prompt: payload.prompt,
        status: payload.status,
        failure: payload.failure,
        replace: options.replace,
        root,
      });
    else await reviewPortrait({ personId: payload.personId, review: payload.review, root });
    return { ok: true };
  }
  throw problem("INVALID_ARGUMENTS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await cli(process.argv.slice(2))));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, code: safeCode(error) }));
    process.exitCode = 1;
  }
}
