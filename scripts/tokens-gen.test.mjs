// tokens-gen.mjs 의 글자 범위 변형(typographyScales) 시험. 임시 사본에서 생성기를 돌려 저장소를 건드리지 않는다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const sandboxes = [];
after(() => sandboxes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// mutate 로 tokens 를 고친 사본을 만들어 생성기를 돌리고 { status, stderr, css } 를 돌려 준다.
const generate = (mutate = () => {}) => {
  const dir = mkdtempSync(join(tmpdir(), "tokens-gen-"));
  sandboxes.push(dir);
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "design"));
  mkdirSync(join(dir, "web"));
  cpSync(join(repo, "scripts/tokens-gen.mjs"), join(dir, "scripts/tokens-gen.mjs"));
  writeFileSync(join(dir, "web/package.json"), "{}");
  const tokens = JSON.parse(readFileSync(join(repo, "design/tokens.json"), "utf8"));
  mutate(tokens);
  writeFileSync(join(dir, "design/tokens.json"), JSON.stringify(tokens));
  const result = spawnSync("node", [join(dir, "scripts/tokens-gen.mjs")], { encoding: "utf8" });
  let css = "";
  try {
    css = readFileSync(join(dir, "web/app/globals.css"), "utf8");
  } catch {
    // 검증에서 멈추면 파일이 없다.
  }
  return { status: result.status, stderr: result.stderr, css };
};

describe("typographyScales", () => {
  it("범위 선택자와 rem 크기를 만든다", () => {
    const { status, css } = generate();
    assert.equal(status, 0);
    assert.match(css, /\[data-type-scale="dashboard"\] \.type-body \{/);
    assert.match(css, /font-size: 1\.0625rem;/);
    assert.match(css, /\[data-type-scale="sidebar"\] \.type-label \{/);
    assert.match(css, /line-height: calc\(25 \/ 17\);/);
  });

  it("범위 변형은 굵기·자간을 내지 않는다", () => {
    const { css } = generate();
    const block = css.match(/\[data-type-scale="dashboard"\] \.type-title \{[^}]*\}/)?.[0] ?? "";
    assert.ok(block.length > 0);
    assert.doesNotMatch(block, /font-weight|letter-spacing/);
  });

  it("typography 에 없는 눈금 이름은 거절한다", () => {
    const { status, stderr } = generate((t) => {
      t.typographyScales.dashboard.nope = { size: 10, lineHeight: 12 };
    });
    assert.equal(status, 1);
    assert.match(stderr, /typographyScales\.dashboard\.nope/);
  });

  it("weight 키는 거절한다", () => {
    const { status, stderr } = generate((t) => {
      t.typographyScales.dashboard.body.weight = 600;
    });
    assert.equal(status, 1);
    assert.match(stderr, /typographyScales\.dashboard\.body\.weight/);
  });

  it("범위 이름 형식이 틀리면 거절한다", () => {
    const { status, stderr } = generate((t) => {
      t.typographyScales.Bad_Name = { body: { size: 10, lineHeight: 12 } };
    });
    assert.equal(status, 1);
    assert.match(stderr, /Bad_Name/);
  });

  it("size 가 숫자가 아니면 거절한다", () => {
    const { status, stderr } = generate((t) => {
      t.typographyScales.sidebar.label.size = "16px";
    });
    assert.equal(status, 1);
    assert.match(stderr, /typographyScales\.sidebar\.label\.size/);
  });
});
