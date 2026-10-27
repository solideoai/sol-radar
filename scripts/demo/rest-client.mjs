// demo/rest-client.mjs — Supabase 프로젝트에 service role 로 쓰는 얇은 HTTP 클라이언트(PostgREST + Auth 관리 API).
//
// 템플릿 db-seed.mjs 의 호출 방식을 따른다. 키는 요청 헤더에만 싣고 오류·로그에 넣지 않는다. 오류에는 상태 코드와
// 서버가 준 짧은 사유(code·message·hint)만 담는다 — details 는 요청 본문을 되돌려 줄 수 있어 싣지 않는다.
//
// 같은 모양(select·insert·upsert·delete·tableExists·functionExists·auth)을 시험이 PGlite 위에 SQL 로 구현해 같은 seed 코드를 돌린다.

const PAGE_SIZE = 1000;
const JWT_PATTERN = /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g;
const SECRET_KEY_PATTERN = /sb_secret_[A-Za-z0-9_-]+/g;

export class RestError extends Error {
  constructor({ method, path, status, code, reason }) {
    super(`${method} ${path} → ${status}${code ? ` ${code}` : ""}: ${reason}`);
    this.name = "RestError";
    this.status = status;
    this.code = code ?? null;
  }
}

// 서버 사유에서 토큰처럼 보이는 것은 가린다(서버가 되돌린 요청 본문에 키가 섞일 수 있다).
const redact = (text) =>
  String(text)
    .replace(JWT_PATTERN, "[redacted]")
    .replace(SECRET_KEY_PATTERN, "[redacted]")
    .slice(0, 300);

const reasonOf = (text) => {
  try {
    const parsed = JSON.parse(text);
    return {
      code: parsed.code ?? parsed.error_code ?? null,
      reason: redact(
        parsed.message ?? parsed.msg ?? parsed.error_description ?? parsed.error ?? text,
      ),
    };
  } catch {
    return { code: null, reason: redact(text) };
  }
};

// PostgREST 필터 값. 쉼표·괄호·따옴표·공백이 들면 큰따옴표로 감싼다.
const quote = (value) => {
  const text = String(value);
  return /[,()"\s]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
};

// { col: v } → col=eq.v, { col: null } → col=is.null, { col: { in: [...] } }, { col: { notIn: [...] } }
export const filterParams = (filters) =>
  Object.entries(filters).map(([column, condition]) => {
    if (condition === null) return [column, "is.null"];
    if (typeof condition === "object" && !Array.isArray(condition)) {
      if (Array.isArray(condition.in)) return [column, `in.(${condition.in.map(quote).join(",")})`];
      if (Array.isArray(condition.notIn))
        return [column, `not.in.(${condition.notIn.map(quote).join(",")})`];
      throw new Error(`모르는 필터입니다: ${column}`);
    }
    return [column, `eq.${condition}`];
  });

export const createRestClient = ({ apiUrl, serviceKey, fetchImpl = globalThis.fetch }) => {
  const base = apiUrl.replace(/\/+$/, "");

  const call = async (method, path, { body, prefer, search } = {}) => {
    const query = search ? `?${new URLSearchParams(search)}` : "";
    const response = await fetchImpl(`${base}${path}${query}`, {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok)
      throw new RestError({ method, path, status: response.status, ...reasonOf(text) });
    return text === "" ? null : JSON.parse(text);
  };

  const rest = (table) => `/rest/v1/${table}`;

  return {
    async tableExists(table) {
      try {
        await call("GET", rest(table), {
          search: [
            ["select", "*"],
            ["limit", "0"],
          ],
        });
        return true;
      } catch (error) {
        if (error instanceof RestError && error.status === 404) return false;
        throw error;
      }
    },
    // RPC 가 있는지 probeArgs 로 실제로 불러 본다. PostgREST 는 없는 함수에 404·PGRST202 를 준다.
    // 함수가 인자를 거절한 오류(400 등)나 성공은 "있다" 이다. 네트워크 오류는 삼키지 않는다.
    async functionExists(name, probeArgs) {
      try {
        await call("POST", `/rest/v1/rpc/${encodeURIComponent(name)}`, { body: probeArgs });
        return true;
      } catch (error) {
        if (error instanceof RestError) return !(error.status === 404 && error.code === "PGRST202");
        throw error;
      }
    },
    select(table, { columns = "*", filters = {} } = {}) {
      return call("GET", rest(table), {
        search: [["select", columns], ...filterParams(filters)],
      });
    },
    async insert(table, rows, { returning = false } = {}) {
      if (rows.length === 0) return [];
      const result = await call("POST", rest(table), {
        body: rows,
        prefer: returning ? "return=representation" : "return=minimal",
      });
      return result ?? [];
    },
    async upsert(table, rows, conflict) {
      if (rows.length === 0) return;
      await call("POST", rest(table), {
        body: rows,
        prefer: "resolution=merge-duplicates,return=minimal",
        search: [["on_conflict", conflict]],
      });
    },
    // returning 이면 바뀐 행을 돌려준다(조건에 맞는 행이 없으면 []). 기본은 지금처럼 돌려주지 않는다.
    async update(table, filters, patch, { returning = false } = {}) {
      if (Object.keys(filters).length === 0)
        throw new Error(`${table}: 조건 없는 update 는 거부합니다`);
      const result = await call("PATCH", rest(table), {
        body: patch,
        prefer: returning ? "return=representation" : "return=minimal",
        search: filterParams(filters),
      });
      return returning ? (result ?? []) : result;
    },
    async delete(table, filters) {
      if (Object.keys(filters).length === 0)
        throw new Error(`${table}: 조건 없는 delete 는 거부합니다`);
      return call("DELETE", rest(table), {
        prefer: "return=minimal",
        search: filterParams(filters),
      });
    },
    auth: {
      async listUsers() {
        const found = [];
        for (let page = 1; ; page += 1) {
          const result = await call("GET", "/auth/v1/admin/users", {
            search: [
              ["page", String(page)],
              ["per_page", String(PAGE_SIZE)],
            ],
          });
          const users = result?.users ?? [];
          found.push(...users.map((user) => ({ id: user.id, email: user.email })));
          if (users.length < PAGE_SIZE) return found;
        }
      },
      async createUser({ email, password, userMetadata }) {
        const created = await call("POST", "/auth/v1/admin/users", {
          body: { email, password, email_confirm: true, user_metadata: userMetadata },
        });
        return { id: created.id, email: created.email };
      },
      async updateUser(id, { email, password, userMetadata }) {
        const updated = await call("PUT", `/auth/v1/admin/users/${id}`, {
          body: { email, password, email_confirm: true, user_metadata: userMetadata },
        });
        return { id: updated.id, email: updated.email };
      },
    },
  };
};
