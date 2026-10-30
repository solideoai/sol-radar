import assert from "node:assert/strict";
import { test } from "node:test";
import { provisionDemoAdmin } from "./demo-admin.mjs";
import { createRestClient } from "../demo/rest-client.mjs";

const clientFor = () => {
  const writes = [];
  const users = [{ id: "existing-user", email: "admin@admin.com" }];
  const client = {
    select: async (table) =>
      table === "organizations"
        ? [{ id: "db4c863c-cb6a-593d-93ff-709a17e0157a", slug: "org-01", is_demo: true }]
        : [],
    upsert: async (table, rows) => writes.push({ table, rows }),
    update: async (table, filters, patch) => writes.push({ table, filters, patch }),
    auth: {
      listUsers: async () => users,
      updateUser: async (id, payload) => {
        writes.push({ table: "auth.users", id, email: payload.email });
        users.find((user) => user.id === id).email = payload.email;
        return { id };
      },
      createUser: async () => {
        throw new Error("기존 계정을 다시 만들면 안 됩니다");
      },
    },
  };
  return { client, writes };
};

test("데모 계정 사전 확인은 DB와 Auth를 변경하지 않는다", async () => {
  const { client, writes } = clientFor();
  const result = await provisionDemoAdmin({ client });
  assert.equal(result.userId, "existing-user");
  assert.deepEqual(writes, []);
});

test("기존 계정 ID를 유지하고 명부·공고·분석을 건드리지 않는다", async () => {
  const { client, writes } = clientFor();
  const first = await provisionDemoAdmin({ client, apply: true, password: "entered-password" });
  const second = await provisionDemoAdmin({ client, apply: true, password: "entered-password" });
  assert.equal(first.userId, "existing-user");
  assert.equal(second.userId, first.userId);
  assert.equal(first.created, false);
  assert.ok(
    writes
      .filter(({ table }) => table === "auth.users")
      .every(({ email }) => email === "admin@solideos.com"),
  );
  assert.deepEqual([...new Set(writes.map(({ table }) => table))].sort(), [
    "auth.users",
    "departments",
    "job_titles",
    "memberships",
    "profiles",
  ]);
  assert.ok(
    writes
      .filter(({ table }) => table === "profiles")
      .every(({ filters }) => filters.id === first.userId),
  );
});

test("새 이메일이 다른 계정에 있으면 기존 계정을 덮어쓰지 않는다", async () => {
  const { client, writes } = clientFor();
  client.auth.listUsers = async () => [
    { id: "existing-user", email: "admin@admin.com" },
    { id: "another-user", email: "admin@solideos.com" },
  ];
  await assert.rejects(
    provisionDemoAdmin({ client, apply: true, password: "entered-password" }),
    /이메일.*다른 계정/,
  );
  assert.deepEqual(writes, []);
});

test("Auth 이메일 변경 요청에 새 이메일과 확인 상태를 전달한다", async () => {
  let sentBody;
  const client = createRestClient({
    apiUrl: "https://auth.example.test",
    serviceKey: "test-service-key",
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return Response.json({ id: "existing-user", email: sentBody.email });
    },
  });
  await client.auth.updateUser("existing-user", { email: "admin@solideos.com" });
  assert.equal(sentBody.email, "admin@solideos.com");
  assert.equal(sentBody.email_confirm, true);
});
