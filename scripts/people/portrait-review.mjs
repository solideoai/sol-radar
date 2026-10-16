import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPortraitState, selectedPortraitFile } from "./portraits.mjs";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

/** Lightweight local gallery. Regenerate after imports; never implies human approval. */
export async function createPortraitGallery({
  root = fileURLToPath(new URL("../../", import.meta.url)),
} = {}) {
  const { people, manifest } = await readPortraitState({ root });
  const cards = [];
  for (const portrait of manifest.portraits) {
    const selected = portrait.candidate?.status === "GENERATED" ? portrait.candidate : portrait;
    let image = "<p>아직 이미지 없음</p>";
    if (["GENERATED", "READY"].includes(selected.status)) {
      try {
        const filename = await selectedPortraitFile(portrait, { root });
        const url = escape(pathToFileURL(filename).href);
        image = `<a href="${url}" target="_blank" rel="noreferrer"><img loading="lazy" src="${url}" alt="${escape(portrait.personId)} 가상 인물"></a>`;
      } catch {
        image = "<p>이미지 읽기 실패</p>";
      }
    }
    const person = people.find((person) => person.personId === portrait.personId);
    const review = selected.review;
    cards.push(
      `<article>${image}<h2>${escape(person?.name)} · ${escape(portrait.personId)}</h2><p>${escape(portrait.gender)} · ${escape(selected.status)}${portrait.candidate?.status === "GENERATED" ? " · 교체 후보 (기존 READY 유지)" : ""}</p><p>검수: ${review ? `${escape(review.actor)} / ${escape(review.reviewer)} / ${escape(review.verdict)}` : "미검수 — 사람 승인 대기"}</p><p>${escape(review?.evidence)}</p><code>${escape(selected.sha256)}</code></article>`,
    );
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "solideo-portrait-review-"));
  if ((await realpath(directory)).startsWith((await realpath(root)) + path.sep))
    throw new Error("GALLERY_MUST_BE_OUTSIDE_REPOSITORY");
  const filename = path.join(directory, "index.html");
  await writeFile(
    filename,
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:; style-src 'unsafe-inline'"><title>솔리데오 가상 인물 사진 검수</title><style>body{font-family:system-ui;min-width:1280px;margin:32px}main{display:grid;grid-template-columns:repeat(5,1fr);gap:20px}article{border:1px solid;padding:12px;overflow-wrap:anywhere}img{width:100%;aspect-ratio:1;object-fit:contain}h2{font-size:16px}code{font-size:10px}</style><h1>DEMO · 솔리데오 가상 인물 ${manifest.portraits.length}명</h1><p>가상 성인, 정장, 얼굴·어깨 구도, 밝은 배경, 1명, 서로 다른 얼굴을 전수 검수하세요. 해시 차이는 얼굴 고유성의 증거가 아닙니다. AI 검수는 사람 승인이 아닙니다.</p><p>검수 대상 이미지의 ID와 SHA-256을 승인 기록에 남기세요. 로컬 파일로 열고 반입·검수 후 목록을 다시 만드세요.</p><main>${cards.join("\n")}</main></html>`,
    { mode: 0o600 },
  );
  return filename;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--root")) {
    console.log(JSON.stringify({ ok: false, code: "INVALID_ARGUMENTS" }));
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify({ path: await createPortraitGallery({ root: args[1] }) }));
    } catch {
      console.log(JSON.stringify({ ok: false, code: "GALLERY_FAILED" }));
      process.exitCode = 1;
    }
  }
}
