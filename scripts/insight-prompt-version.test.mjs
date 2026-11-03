// 추천 분석 출력 버전 글자가 세 곳에서 같은지 본다(ADR-078, 계획 C1·C2).
// 웹 계약(INSIGHT_PROMPT_VERSION), gateway 응답 버전, DB 중복 제약의 버전 글자가 어긋나면
// 서버는 새 형식으로 다시 요청하게 두는데 DB 가 막거나(23P01), 같은 형식을 또 만들어 모델을 다시 부른다.
// 마이그레이션은 recommendation_insights_pending_or_model_once 를 마지막으로 다시 만든 파일을 읽는다.
// 버전을 올릴 때는 새 마이그레이션으로 이 제약을 다시 만든다(기존 파일은 고치지 않는다).
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");
const CONSTRAINT = "recommendation_insights_pending_or_model_once";

const matchOne = (text, pattern, where) => {
  const found = text.match(pattern);
  assert.ok(found, `${where} 에서 버전 글자를 찾지 못했다`);
  return found[1];
};

async function migrationVersion() {
  const dir = new URL("supabase/migrations/", ROOT);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const pattern = new RegExp(
    String.raw`add constraint ${CONSTRAINT}\b[\s\S]*?prompt_version = '([^']+)'`,
  );
  for (const name of files.reverse()) {
    const sql = await readFile(new URL(name, dir), "utf8");
    if (sql.includes(`add constraint ${CONSTRAINT}`))
      return { name, version: matchOne(sql, pattern, name) };
  }
  assert.fail(`${CONSTRAINT} 를 만드는 마이그레이션이 없다`);
}

describe("추천 분석 출력 버전", () => {
  it("웹 계약·gateway·DB 중복 제약의 버전 글자가 같다", async () => {
    const web = matchOne(
      await read("web/server/insight/insight.model.ts"),
      /export const INSIGHT_PROMPT_VERSION = "([^"]+)"/,
      "web/server/insight/insight.model.ts",
    );
    const gateway = matchOne(
      await read("services/ai/src/sol_ai/insight.py"),
      /^INSIGHT_PROMPT_VERSION = "([^"]+)"/m,
      "services/ai/src/sol_ai/insight.py",
    );
    const migration = await migrationVersion();
    assert.deepEqual(
      { gateway, migration: migration.version },
      { gateway: web, migration: web },
      `웹 ${web}, gateway ${gateway}, ${migration.name} ${migration.version}`,
    );
  });
});
