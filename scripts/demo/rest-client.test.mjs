import assert from "node:assert/strict";
import { test } from "node:test";
import { createRestClient } from "./rest-client.mjs";

const failingClient = (message) =>
  createRestClient({
    apiUrl: "http://127.0.0.1:54321",
    serviceKey: "service-key",
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message }),
    }),
  });

test("오류 메시지에서 sb_secret_ 새 형식 키를 가린다", async () => {
  const client = failingClient("bad key sb_secret_abc123-XYZ_9 rejected");
  await assert.rejects(client.select("organizations"), (error) => {
    assert.match(error.message, /bad key \[redacted\] rejected/);
    assert.doesNotMatch(error.message, /sb_secret_/);
    return true;
  });
});

test("오류 메시지에서 JWT 도 계속 가린다", async () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJlMTIzNDU";
  const client = failingClient(`token ${jwt} rejected`);
  await assert.rejects(client.select("organizations"), (error) => {
    assert.match(error.message, /token \[redacted\] rejected/);
    assert.doesNotMatch(error.message, /eyJ/);
    return true;
  });
});
