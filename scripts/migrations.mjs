// 마이그레이션 목록 규칙 — 무엇을, 어떤 순서로 적용할지. db-push.mjs 가 부른다.
//
// 순수 함수만 둔다. 파일을 읽고 DB 에 적용하는 일은 db-push.mjs 가 한다.

// 파일 이름: <숫자 버전>_<이름>.sql (Supabase CLI 와 같은 규칙). 예: 20260101000001_init.sql
// 버전이 이력 표에 남는 열쇠다. 같은 버전을 다시 적용하지 않는다.
const FILE_NAME = /^(\d+)_(.+)\.sql$/;

export const parseMigrationFile = (file) => {
  const match = FILE_NAME.exec(file);
  return match ? { file, version: match[1], name: match[2] } : null;
};

// 버전은 숫자다. 글자 순으로 정렬하면 "10" 이 "9" 보다 앞에 오므로 자릿수부터 비교한다.
const byVersion = (a, b) =>
  a.version.length - b.version.length ||
  (a.version < b.version ? -1 : a.version > b.version ? 1 : 0);

// 폴더의 파일 이름들 → 버전 순 마이그레이션 목록과 문제 목록. 문제가 하나라도 있으면 아무것도 적용하지 않는다.
// .sql 이 아닌 파일(README 등)은 마이그레이션이 아니라서 건너뛴다.
export const collectMigrations = (files) => {
  const sqlFiles = files.filter((file) => file.endsWith(".sql"));
  const migrations = sqlFiles.map(parseMigrationFile).filter(Boolean).sort(byVersion);

  const badNames = sqlFiles
    .filter((file) => !parseMigrationFile(file))
    .map((file) => `이름이 규칙에 맞지 않습니다: ${file} (형식: <숫자 버전>_<이름>.sql)`);

  const duplicates = [...new Set(migrations.map((m) => m.version))]
    .map((version) => migrations.filter((m) => m.version === version))
    .filter((same) => same.length > 1)
    .map(
      (same) =>
        `버전이 겹칩니다: ${same.map((m) => m.file).join(", ")} (버전은 이력의 열쇠라 하나씩만)`,
    );

  return { migrations, problems: [...badNames, ...duplicates] };
};

// 이력 표에 없는 것만, 버전 순서 그대로.
export const pendingMigrations = (migrations, appliedVersions) => {
  const applied = new Set(appliedVersions);
  return migrations.filter((m) => !applied.has(m.version));
};
