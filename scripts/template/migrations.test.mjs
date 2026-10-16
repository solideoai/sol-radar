// 마이그레이션 목록 규칙(scripts/migrations.mjs) 테스트. DB 에 붙는 부분(db-push.mjs)은 여기서 보지 않는다.
// 실행: 루트에서 `pnpm test`
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { collectMigrations, parseMigrationFile, pendingMigrations } from "../migrations.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const files = (migrations) => migrations.map((m) => m.file);

describe("파일 이름: <숫자 버전>_<이름>.sql", () => {
  it("버전과 이름을 뽑는다", () => {
    assert.deepEqual(parseMigrationFile("20260101000001_init.sql"), {
      file: "20260101000001_init.sql",
      version: "20260101000001",
      name: "init",
    });
  });

  it("이름 안의 밑줄은 이름에 남는다", () => {
    assert.equal(parseMigrationFile("20260102000000_add_user_id.sql")?.name, "add_user_id");
  });

  it("규칙에 맞지 않으면 null", () => {
    [
      "init.sql",
      "v1_init.sql",
      "20260101_.sql",
      "20260101000001-init.sql",
      "20260101000001_init.SQL",
    ].forEach((file) => assert.equal(parseMigrationFile(file), null, file));
  });
});

describe("목록 모으기", () => {
  it("버전 순으로 정렬한다 (자릿수가 달라도 숫자 순)", () => {
    const { migrations, problems } = collectMigrations([
      "10_b.sql",
      "9_a.sql",
      "20260101000001_init.sql",
    ]);
    assert.deepEqual(problems, []);
    assert.deepEqual(files(migrations), ["9_a.sql", "10_b.sql", "20260101000001_init.sql"]);
  });

  it(".sql 이 아닌 파일은 건너뛴다", () => {
    const { migrations, problems } = collectMigrations(["README.md", ".gitkeep", "1_a.sql"]);
    assert.deepEqual(problems, []);
    assert.deepEqual(files(migrations), ["1_a.sql"]);
  });

  it("이름이 규칙에 맞지 않는 .sql 은 문제로 알린다", () => {
    const { problems } = collectMigrations(["1_a.sql", "seed.sql"]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /seed\.sql/);
  });

  it("버전이 겹치면 문제로 알린다", () => {
    const { problems } = collectMigrations(["1_a.sql", "1_b.sql", "2_c.sql"]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /1_a\.sql, 1_b\.sql/);
  });

  it("저장소의 마이그레이션 파일은 모두 규칙을 지킨다", () => {
    const { migrations, problems } = collectMigrations(
      readdirSync(join(root, "supabase/migrations")),
    );
    assert.deepEqual(problems, []);
    assert.ok(migrations.length > 0);
  });
});

describe("적용할 것 고르기", () => {
  const { migrations } = collectMigrations(["1_a.sql", "2_b.sql", "3_c.sql"]);

  it("이력에 없는 것만 버전 순서 그대로 고른다", () => {
    assert.deepEqual(files(pendingMigrations(migrations, ["2"])), ["1_a.sql", "3_c.sql"]);
  });

  it("이력이 비어 있으면 전부", () => {
    assert.deepEqual(files(pendingMigrations(migrations, [])), ["1_a.sql", "2_b.sql", "3_c.sql"]);
  });

  it("전부 적용됐으면 빈 목록", () => {
    assert.deepEqual(pendingMigrations(migrations, ["1", "2", "3"]), []);
  });

  it("파일이 없는 버전이 이력에 있어도 무시한다", () => {
    assert.deepEqual(files(pendingMigrations(migrations, ["1", "2", "3", "99"])), []);
  });
});
