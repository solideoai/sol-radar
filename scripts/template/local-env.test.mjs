// 로컬 Supabase env 규칙(scripts/local-env.mjs) 테스트. 실행: 루트에서 `pnpm test`
//
// 순수 함수만 본다. CLI 를 부르고 파일을 쓰는 db-local.mjs 는 scripts/template/db-local.test.mjs 가 본다.
// 픽스처 키는 진짜 키처럼 생기지 않게 둔다(비밀값 가드가 시험 파일에도 걸린다).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  isLocalUrl,
  localEnvUpdates,
  localMailSettings,
  localMailUpdates,
  mergeEnv,
  parseDbLocalArgs,
  parseStatusEnv,
  pickLanIp,
  planEnvFile,
  toMobileUrl,
  unsetMailUpdates,
} from "../local-env.mjs";

const LOCAL_API = "http://127.0.0.1:54321";
const CLOUD_API = "https://abc.supabase.co";
const ANON = "anon-zz-3307";
const WEB_URL = "NEXT_PUBLIC_SUPABASE_URL";
const WEB_ANON = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const MOBILE_URL = "EXPO_PUBLIC_SUPABASE_URL";

// env 파일·결과 어디에도 나오면 안 되는 값. 이름에 SERVICE_ROLE·SECRET_KEY 가 든 값은 20자 미만(가드 규칙).
const SECRETS = {
  SERVICE_ROLE_KEY: "svc-zz-7781",
  SECRET_KEY: "sec-zz-4410",
  JWT_SECRET: "jwt-zz-1203",
  DB_URL: "postgresql://postgres:dbpw-zz-5520@127.0.0.1:54322/postgres",
};

const lines = (...rows) => `${rows.join("\n")}\n`;
const crlf = (...rows) => `${rows.join("\r\n")}\r\n`;
const webUpdates = [
  [WEB_URL, LOCAL_API],
  [WEB_ANON, ANON],
];
const planWeb = (existing, example = null) =>
  planEnvFile({ existing, example, updates: webUpdates, urlKey: WEB_URL });
const isKorean = (error) => error instanceof Error && /[가-힣]/.test(error.message);

describe("parseStatusEnv — supabase status -o env 읽기", () => {
  it("KEY=값 줄을 읽고 양쪽 큰따옴표를 벗긴다", () => {
    assert.deepEqual(parseStatusEnv(lines(`API_URL="${LOCAL_API}"`, `ANON_KEY="${ANON}"`)), {
      API_URL: LOCAL_API,
      ANON_KEY: ANON,
    });
  });

  it("작은따옴표도 벗기고, 양쪽이 같은 따옴표가 아니면 그대로 둔다", () => {
    assert.deepEqual(parseStatusEnv(lines("A='x'", `B="y'`, 'C="', "D=plain")), {
      A: "x",
      B: `"y'`,
      C: '"',
      D: "plain",
    });
  });

  it("첫 = 에서만 나눠 값 안의 = 는 값으로 남는다", () => {
    assert.deepEqual(parseStatusEnv('K="a=b=c"\n'), { K: "a=b=c" });
  });

  it("CRLF 줄바꿈도 읽는다 (값 끝에 \\r 가 남지 않는다)", () => {
    assert.deepEqual(parseStatusEnv(crlf(`API_URL="${LOCAL_API}"`, `ANON_KEY="${ANON}"`)), {
      API_URL: LOCAL_API,
      ANON_KEY: ANON,
    });
  });

  it("KEY=값 꼴이 아닌 줄(안내문·빈 줄·들여쓴 줄)은 건너뛴다", () => {
    const text = lines(
      "Stopped services: [x]",
      "",
      "  INDENTED=1",
      "1BAD=2",
      `API_URL="${LOCAL_API}"`,
    );
    assert.deepEqual(parseStatusEnv(text), { API_URL: LOCAL_API });
  });

  it("빈 값은 빈 문자열로 읽는다", () => {
    assert.deepEqual(parseStatusEnv(lines("A=", 'B=""')), { A: "", B: "" });
  });
});

describe("isLocalUrl — 클라우드 주소를 로컬로 오인하지 않는다", () => {
  it("loopback 주소(127.x·localhost·[::1])는 로컬이다", () => {
    [LOCAL_API, "http://127.1.2.3", "http://localhost:54321", "http://[::1]:54321"].forEach((url) =>
      assert.equal(isLocalUrl(url), true, url),
    );
  });

  it("사설 대역(10/8·172.16/12·192.168/16)은 경계까지 로컬이다", () => {
    [
      "http://10.0.0.1:54321",
      "http://10.255.255.255",
      "http://172.16.0.1:54321",
      "http://172.31.255.255",
      "http://192.168.0.10:54321",
      "http://192.168.255.255",
    ].forEach((url) => assert.equal(isLocalUrl(url), true, url));
  });

  it("사설 대역 바로 바깥(172.15·172.32·192.169·11.x)은 로컬이 아니다", () => {
    [
      "http://172.15.255.255",
      "http://172.32.0.1:54321",
      "http://192.169.0.1",
      "http://11.0.0.1",
      "http://128.0.0.1",
    ].forEach((url) => assert.equal(isLocalUrl(url), false, url));
  });

  it("클라우드 주소는 로컬이 아니다 (로컬처럼 보이게 꾸민 주소 포함)", () => {
    [
      CLOUD_API,
      "https://abc.supabase.co:443/rest/v1",
      "http://127.0.0.1.nip.io:54321",
      "http://localhost.abc.supabase.co",
      "http://10.0.0.1@abc.supabase.co",
    ].forEach((url) => assert.equal(isLocalUrl(url), false, url));
  });

  it("빈 값·문자열이 아닌 값·URL 이 아닌 값은 로컬이 아니다", () => {
    ["", null, undefined, 127001, {}, "not a url", "http://", "://127.0.0.1"].forEach((value) =>
      assert.equal(isLocalUrl(value), false, String(value)),
    );
  });
});

describe("pickLanIp — 폰이 닿을 PC 주소 고르기", () => {
  const v4 = (address) => ({ address, family: "IPv4", internal: false });

  it("인터페이스 목록이 없거나 비었으면 null", () => {
    assert.equal(pickLanIp(undefined), null);
    assert.equal(pickLanIp({}), null);
  });

  it("내부(loopback)·IPv6·169.254 주소는 고르지 않는다", () => {
    assert.equal(
      pickLanIp({
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        en0: [{ address: "fe80::1", family: "IPv6", internal: false }, v4("169.254.10.20")],
      }),
      null,
    );
  });

  it("family 가 숫자 4 여도 IPv4 로 읽는다", () => {
    assert.equal(
      pickLanIp({ eth0: [{ address: "192.168.0.10", family: 4, internal: false }] }),
      "192.168.0.10",
    );
  });

  it("가상 인터페이스는 이름의 대소문자와 상관없이 고르지 않는다", () => {
    [
      "docker0",
      "Docker",
      "br-1a2b3c4d",
      "veth12ab",
      "vEthernet (WSL)",
      "bridge100",
      "utun3",
      "vboxnet0",
      "vmnet8",
      "awdl0",
      "llw0",
      "VMware Network Adapter VMnet1",
      "VirtualBox Host-Only Network",
    ].forEach((name) => assert.equal(pickLanIp({ [name]: [v4("10.0.0.5")] }), null, name));
  });

  it("실제 랜카드(en·eth·wl·Wi-Fi)를 다른 인터페이스보다 먼저 고른다", () => {
    ["en0", "eth0", "enp0s3", "wlan0", "wlp2s0", "Wi-Fi", "WiFi", "Ethernet"].forEach((name) =>
      assert.equal(
        pickLanIp({ tailscale0: [v4("100.64.0.3")], [name]: [v4("192.168.0.10")] }),
        "192.168.0.10",
        name,
      ),
    );
  });

  it("실제 랜카드가 없으면 가상이 아닌 다른 인터페이스를 고른다", () => {
    assert.equal(
      pickLanIp({ docker0: [v4("172.17.0.1")], tailscale0: [v4("100.64.0.3")] }),
      "100.64.0.3",
    );
  });

  it("주소 목록이 undefined 인 인터페이스는 건너뛴다", () => {
    assert.equal(pickLanIp({ en0: undefined, eth1: [v4("10.0.0.7")] }), "10.0.0.7");
  });
});

describe("toMobileUrl — 앱에 적을 주소", () => {
  it("loopback 이면 호스트만 바꾸고 포트를 지키며 끝에 / 를 붙이지 않는다", () => {
    assert.equal(toMobileUrl(LOCAL_API, "192.168.0.10"), "http://192.168.0.10:54321");
  });

  it("경로·쿼리는 그대로 둔다", () => {
    assert.equal(
      toMobileUrl("http://127.0.0.1:54321/rest/v1?select=id", "192.168.0.10"),
      "http://192.168.0.10:54321/rest/v1?select=id",
    );
  });

  it("localhost·[::1] 도 바꾼다", () => {
    assert.equal(toMobileUrl("http://localhost:54321", "my-pc.local"), "http://my-pc.local:54321");
    assert.equal(toMobileUrl("http://[::1]:54321", "192.168.0.10"), "http://192.168.0.10:54321");
  });

  it("host 가 없으면(null·빈 값) 원래 값", () => {
    assert.equal(toMobileUrl(LOCAL_API, null), LOCAL_API);
    assert.equal(toMobileUrl(LOCAL_API, ""), LOCAL_API);
  });

  it("loopback 이 아니면(LAN·클라우드·URL 아님) 원래 값", () => {
    ["http://10.0.0.2:54321", CLOUD_API, "not a url"].forEach((url) =>
      assert.equal(toMobileUrl(url, "192.168.0.10"), url, url),
    );
  });
});

describe("localEnvUpdates — 무엇을 어디에 적나", () => {
  const status = { API_URL: LOCAL_API, ANON_KEY: ANON };

  it("웹·앱에 주소 다음 anon 키 순서로 두 값씩 낸다", () => {
    assert.deepEqual(localEnvUpdates(status, "192.168.0.10"), {
      web: [
        [WEB_URL, LOCAL_API],
        [WEB_ANON, ANON],
      ],
      mobile: [
        [MOBILE_URL, "http://192.168.0.10:54321"],
        ["EXPO_PUBLIC_SUPABASE_ANON_KEY", ANON],
      ],
    });
  });

  it("mobileHost 가 없으면 앱 주소도 API_URL 그대로", () => {
    assert.deepEqual(localEnvUpdates(status, null).mobile[0], [MOBILE_URL, LOCAL_API]);
  });

  it("ANON_KEY 가 없거나 비었으면 PUBLISHABLE_KEY 를 쓴다", () => {
    [{}, { ANON_KEY: "" }].forEach((anon) => {
      const updates = localEnvUpdates(
        { API_URL: LOCAL_API, PUBLISHABLE_KEY: "pub-zz-1", ...anon },
        null,
      );
      assert.deepEqual(updates.web[1], [WEB_ANON, "pub-zz-1"]);
      assert.deepEqual(updates.mobile[1], ["EXPO_PUBLIC_SUPABASE_ANON_KEY", "pub-zz-1"]);
    });
  });

  it("ANON_KEY 와 PUBLISHABLE_KEY 가 둘 다 있으면 ANON_KEY", () => {
    const updates = localEnvUpdates({ ...status, PUBLISHABLE_KEY: "pub-zz-1" }, null);
    assert.deepEqual(updates.web[1], [WEB_ANON, ANON]);
  });

  it("API_URL 이 없으면 한글 오류", () => {
    assert.throws(
      () => localEnvUpdates({ ANON_KEY: ANON }, null),
      (error) => isKorean(error) && /API_URL/.test(error.message),
    );
  });

  it("ANON_KEY·PUBLISHABLE_KEY 가 둘 다 없으면 한글 오류", () => {
    assert.throws(
      () => localEnvUpdates({ API_URL: LOCAL_API, ...SECRETS }, null),
      (error) => isKorean(error) && /ANON_KEY/.test(error.message),
    );
  });

  it("service_role·secret 키·JWT secret·DB 주소는 웹·앱 어디에도 싣지 않는다", () => {
    [null, "192.168.0.10"].forEach((host) => {
      const flat = JSON.stringify(localEnvUpdates({ ...status, ...SECRETS }, host));
      Object.values(SECRETS).forEach((value) =>
        assert.equal(flat.includes(value), false, `${value} 가 결과에 있다`),
      );
      assert.equal(flat.includes("dbpw-zz-5520"), false);
    });
  });
});

describe("mergeEnv — env 파일 고치기", () => {
  it("있는 키는 그 줄의 값만 바꾸고 다른 줄·빈 줄·순서는 그대로 둔다", () => {
    const text = lines(
      "# 머리말",
      "A=1",
      `${WEB_URL}=https://old.example`,
      "B=2",
      "",
      "C=3",
      `${WEB_ANON}=old`,
      "D=4",
    );
    assert.equal(
      mergeEnv(text, webUpdates),
      lines(
        "# 머리말",
        "A=1",
        `${WEB_URL}=${LOCAL_API}`,
        "B=2",
        "",
        "C=3",
        `${WEB_ANON}=${ANON}`,
        "D=4",
      ),
    );
  });

  it("주석으로 꺼 둔 줄(# KEY=)은 건드리지 않고, 없는 키는 끝에 붙인다", () => {
    const text = lines(
      `# ${WEB_URL}=${CLOUD_API}`,
      `#${WEB_ANON}=old`,
      "# SUPABASE_SERVICE_ROLE_KEY=",
    );
    assert.equal(
      mergeEnv(text, webUpdates),
      lines(
        `# ${WEB_URL}=${CLOUD_API}`,
        `#${WEB_ANON}=old`,
        "# SUPABASE_SERVICE_ROLE_KEY=",
        `${WEB_URL}=${LOCAL_API}`,
        `${WEB_ANON}=${ANON}`,
      ),
    );
  });

  it("같은 키가 여러 줄이면 모두 바꾼다", () => {
    const text = lines(`${WEB_URL}=a`, "X=1", `${WEB_URL}=b`);
    assert.equal(
      mergeEnv(text, [[WEB_URL, LOCAL_API]]),
      lines(`${WEB_URL}=${LOCAL_API}`, "X=1", `${WEB_URL}=${LOCAL_API}`),
    );
  });

  it("export KEY= 줄과 = 양옆에 공백이 있는 줄도 그 자리에서 바꾼다", () => {
    const result = mergeEnv(
      lines(`export ${WEB_URL}=${CLOUD_API}`, `${WEB_ANON} = old`, "X=1"),
      webUpdates,
    )
      .split("\n")
      .slice(0, -1);
    assert.equal(result.length, 3);
    assert.match(result[0], new RegExp(`^(export )?${WEB_URL}=${LOCAL_API}$`));
    assert.equal(result[1], `${WEB_ANON}=${ANON}`);
    assert.equal(result[2], "X=1");
  });

  it("없던 키는 넘긴 순서대로 끝에 붙인다", () => {
    assert.equal(
      mergeEnv(lines("X=1"), webUpdates),
      lines("X=1", `${WEB_URL}=${LOCAL_API}`, `${WEB_ANON}=${ANON}`),
    );
  });

  it("파일이 없으면(null) 넣을 값만으로 만든다", () => {
    assert.equal(
      mergeEnv(null, webUpdates),
      lines(`${WEB_URL}=${LOCAL_API}`, `${WEB_ANON}=${ANON}`),
    );
    assert.equal(mergeEnv(null, []), "");
  });

  it("끝 줄바꿈은 하나로 맞춘다", () => {
    assert.equal(mergeEnv("X=1", []), "X=1\n");
    assert.equal(mergeEnv("X=1\n\n\n", [["Y", "2"]]), "X=1\nY=2\n");
  });

  it("CRLF 파일은 바꾼 줄·붙인 줄까지 CRLF 로 쓴다", () => {
    const result = mergeEnv(crlf("# c", `${WEB_URL}=old`, "X=1"), webUpdates);
    assert.equal(result, crlf("# c", `${WEB_URL}=${LOCAL_API}`, "X=1", `${WEB_ANON}=${ANON}`));
    assert.doesNotMatch(result, /(?<!\r)\n/);
  });

  it("두 번 적용해도 결과가 같다", () => {
    [
      null,
      "",
      lines("X=1"),
      lines(`${WEB_URL}=a`, `# ${WEB_URL}=b`, `${WEB_URL}=c`),
      crlf("# c", `${WEB_URL}=old`),
      "X=1\n\n\n",
      `export ${WEB_URL}=${CLOUD_API}`,
    ].forEach((text) => {
      const once = mergeEnv(text, webUpdates);
      assert.equal(mergeEnv(once, webUpdates), once, JSON.stringify(text));
    });
  });

  it("값에 줄바꿈(\\n·\\r)이 있으면 쓰지 않고 오류", () => {
    [`${LOCAL_API}\nINJECTED=1`, `${LOCAL_API}\rINJECTED=1`].forEach((value) =>
      assert.throws(() => mergeEnv(lines("X=1"), [[WEB_URL, value]]), isKorean),
    );
  });
});

describe("planEnvFile — env 파일 하나를 어떻게 할지", () => {
  const EXAMPLE = lines(
    "# 예시",
    `${WEB_URL}=`,
    `${WEB_ANON}=`,
    "",
    "# SUPABASE_SERVICE_ROLE_KEY=",
  );
  const FILLED = lines(`${WEB_URL}=${LOCAL_API}`, `${WEB_ANON}=${ANON}`);
  const assertSkip = (plan, label) => {
    assert.equal(plan.action, "skip", label);
    assert.equal("text" in plan, false, label);
    assert.match(plan.reason, new RegExp(WEB_URL), label);
  };

  it("파일이 없으면 .env.example 을 바탕으로 쓴다", () => {
    [null, undefined].forEach((existing) =>
      assert.deepEqual(planWeb(existing, EXAMPLE), {
        action: "write",
        text: lines(
          "# 예시",
          `${WEB_URL}=${LOCAL_API}`,
          `${WEB_ANON}=${ANON}`,
          "",
          "# SUPABASE_SERVICE_ROLE_KEY=",
        ),
      }),
    );
  });

  it("파일도 .env.example 도 없으면 두 값만 쓴다", () => {
    assert.deepEqual(planWeb(null, null), { action: "write", text: FILLED });
  });

  it("주소 자리에 클라우드 주소가 있으면 건너뛰고 쓸 내용을 내지 않는다", () => {
    [
      lines(`${WEB_URL}=${CLOUD_API}`, `${WEB_ANON}=cloud-anon`),
      lines(`${WEB_URL}="${CLOUD_API}"`),
      lines(`${WEB_URL}='${CLOUD_API}'`),
      lines(`export ${WEB_URL}=${CLOUD_API}`),
      lines(`${WEB_URL} = ${CLOUD_API}`),
      lines(`${WEB_URL}=${CLOUD_API} # 운영`),
      crlf(`${WEB_URL}=${CLOUD_API}`),
    ].forEach((existing) => assertSkip(planWeb(existing, EXAMPLE), existing));
  });

  it("같은 키가 여러 줄이면 하나라도 클라우드면 건너뛴다", () => {
    [
      lines(`${WEB_URL}=${LOCAL_API}`, `${WEB_URL}=${CLOUD_API}`),
      lines(`${WEB_URL}=${CLOUD_API}`, `${WEB_URL}=${LOCAL_API}`),
    ].forEach((existing) => assertSkip(planWeb(existing), existing));
  });

  it("주석으로 꺼 둔 클라우드 주소는 판단에 쓰지 않고 그 줄을 남긴다", () => {
    assert.deepEqual(planWeb(lines(`# ${WEB_URL}=${CLOUD_API}`)), {
      action: "write",
      text: lines(`# ${WEB_URL}=${CLOUD_API}`, `${WEB_URL}=${LOCAL_API}`, `${WEB_ANON}=${ANON}`),
    });
  });

  it("로컬 주소에 옛 키가 있으면 새 값으로 쓴다", () => {
    assert.deepEqual(planWeb(lines(`${WEB_URL}=http://localhost:54321`, `${WEB_ANON}=old`)), {
      action: "write",
      text: FILLED,
    });
  });

  it("옛 LAN IP 가 적힌 앱 파일은 새 IP 로 쓴다", () => {
    const plan = planEnvFile({
      existing: lines(`${MOBILE_URL}=http://192.168.0.5:54321`),
      example: null,
      updates: [[MOBILE_URL, "http://192.168.0.10:54321"]],
      urlKey: MOBILE_URL,
    });
    assert.deepEqual(plan, {
      action: "write",
      text: lines(`${MOBILE_URL}=http://192.168.0.10:54321`),
    });
  });

  it("이미 같은 값이면 unchanged", () => {
    assert.deepEqual(planWeb(FILLED, EXAMPLE), { action: "unchanged" });
    assert.deepEqual(planWeb(crlf(`${WEB_URL}=${LOCAL_API}`, `${WEB_ANON}=${ANON}`)), {
      action: "unchanged",
    });
  });

  it("주소가 빈 값이면 쓴다", () => {
    [`${WEB_URL}=`, `${WEB_URL}=""`, `${WEB_URL}=   `].forEach((row) =>
      assert.deepEqual(planWeb(lines(row)), { action: "write", text: FILLED }, row),
    );
  });

  it("다른 키의 클라우드 주소는 판단에 쓰지 않는다", () => {
    assert.equal(planWeb(lines(`OTHER_URL=${CLOUD_API}`)).action, "write");
  });
});

describe("parseDbLocalArgs — db-local.mjs 의 인자", () => {
  it("start·stop 을 읽고 host 는 기본 null", () => {
    assert.deepEqual(parseDbLocalArgs(["start"]), { command: "start", host: null });
    assert.deepEqual(parseDbLocalArgs(["stop"]), { command: "stop", host: null });
  });

  it("--host X 와 --host=X 를 읽는다", () => {
    const expected = { command: "start", host: "192.168.0.10" };
    assert.deepEqual(parseDbLocalArgs(["start", "--host", "192.168.0.10"]), expected);
    assert.deepEqual(parseDbLocalArgs(["start", "--host=192.168.0.10"]), expected);
  });

  it("단독 -- 는 건너뛴다", () => {
    assert.deepEqual(parseDbLocalArgs(["start", "--", "--host", "192.168.0.10"]), {
      command: "start",
      host: "192.168.0.10",
    });
    assert.deepEqual(parseDbLocalArgs(["--", "stop"]), { command: "stop", host: null });
  });

  it("호스트 이름도 받는다", () => {
    assert.equal(parseDbLocalArgs(["start", "--host", "my-pc.local"]).host, "my-pc.local");
  });

  it("명령이 없거나 모르는 명령이면 한글 오류", () => {
    [[], ["--"], ["restart"], ["--host", "192.168.0.10"]].forEach((argv) =>
      assert.throws(() => parseDbLocalArgs(argv), isKorean, JSON.stringify(argv)),
    );
  });

  it("모르는 인자는 오류", () => {
    [
      ["start", "--verbose"],
      ["start", "extra"],
      ["stop", "-h"],
    ].forEach((argv) =>
      assert.throws(() => parseDbLocalArgs(argv), /모르는 인자/, JSON.stringify(argv)),
    );
  });

  it("--host 값이 없거나 비었으면 오류", () => {
    [
      ["start", "--host"],
      ["start", "--host="],
      ["start", "--host", ""],
      ["start", "--host", "--other"],
    ].forEach((argv) =>
      assert.throws(() => parseDbLocalArgs(argv), /--host/, JSON.stringify(argv)),
    );
  });

  it("고쳐 읽히는 호스트(1.2.3·256.x)와 공백·경로·포트·사용자가 섞인 값은 오류", () => {
    [
      "1.2.3",
      "256.1.1.1",
      "192.168.0.10 x",
      "192.168.0.10/x",
      "192.168.0.10:8081",
      "user@192.168.0.10",
    ].forEach((host) =>
      assert.throws(() => parseDbLocalArgs(["start", "--host", host]), /--host/, host),
    );
  });

  it("--host 를 두 번 적으면 오류", () => {
    [
      ["start", "--host", "192.168.0.10", "--host", "192.168.0.11"],
      ["start", "--host=192.168.0.10", "--host", "192.168.0.10"],
    ].forEach((argv) =>
      assert.throws(() => parseDbLocalArgs(argv), /한 번만/, JSON.stringify(argv)),
    );
  });
});

// 초대 메일을 로컬 메일함으로 보내는 값(4-2절). 스펙: polaris/specs/done/team-settings-mail-csp-errors.md 3장 4번.
const MAIL_SETTINGS = { smtpPort: "54325", siteUrl: "http://localhost:3000" };
const MAIL_UPDATES = [
  ["SMTP_HOST", "127.0.0.1"],
  ["SMTP_PORT", "54325"],
  ["MAIL_FROM", "no-reply@example.com"],
  ["SITE_URL", "http://localhost:3000"],
];

describe("localMailSettings — supabase/config.toml 에서 메일함 SMTP 포트와 웹 주소 읽기", () => {
  it("[local_smtp] 의 smtp_port 와 [auth] 의 site_url 을 읽는다", () => {
    assert.deepEqual(
      localMailSettings(
        lines(
          "[local_smtp]",
          "smtp_port = 54325",
          "",
          "[auth]",
          "enabled = true",
          'site_url = "http://localhost:3000"',
        ),
      ),
      MAIL_SETTINGS,
    );
  });

  it("저장소의 supabase/config.toml 을 읽으면 54325 와 http://localhost:3000 이다", () => {
    const text = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
    assert.deepEqual(localMailSettings(text), MAIL_SETTINGS);
  });

  it("옛 이름 [inbucket] 의 smtp_port 도 읽고, 둘 다 있으면 [local_smtp] 를 쓴다", () => {
    const auth = ["[auth]", "site_url = 'http://localhost:3000'"];
    assert.deepEqual(
      localMailSettings(lines("[inbucket]", "smtp_port = 54325", ...auth)),
      MAIL_SETTINGS,
    );
    assert.deepEqual(
      localMailSettings(
        lines("[inbucket]", "smtp_port = 1111", "[local_smtp]", "smtp_port = 54325", ...auth),
      ),
      MAIL_SETTINGS,
    );
  });

  it("값 뒤의 주석과 표 이름 뒤의 주석, 들여쓰기·CRLF 를 견딘다", () => {
    assert.deepEqual(
      localMailSettings(
        crlf(
          "[local_smtp] # 메일함",
          "  smtp_port = 54325  # SMTP",
          "[auth]",
          '  site_url = "http://localhost:3000" # 웹',
        ),
      ),
      MAIL_SETTINGS,
    );
  });

  it("다른 표의 같은 이름은 읽지 않는다", () => {
    assert.equal(
      localMailSettings(
        lines("[api]", "smtp_port = 54325", "site_url = 'http://x'", "[auth]", "enabled = true"),
      ),
      null,
    );
  });

  it("메일함 SMTP 포트를 열지 않았거나(주석 처리 포함) 웹 주소가 없으면 null", () => {
    const auth = ["[auth]", 'site_url = "http://localhost:3000"'];
    assert.equal(localMailSettings(lines("[local_smtp]", "# smtp_port = 54325", ...auth)), null);
    assert.equal(localMailSettings(lines(...auth)), null);
    assert.equal(localMailSettings(lines("[local_smtp]", "smtp_port = 54325", "[auth]")), null);
    assert.equal(localMailSettings(null), null);
    assert.equal(localMailSettings(""), null);
  });
});

describe("localMailUpdates — 웹 env 에 적을 메일 값", () => {
  it("메일함 주소의 호스트·config 의 포트·보내는 주소·웹 주소 순서로 네 값을 낸다", () => {
    assert.deepEqual(
      localMailUpdates({ MAILPIT_URL: "http://127.0.0.1:54324" }, MAIL_SETTINGS),
      MAIL_UPDATES,
    );
  });

  it("MAILPIT_URL 이 없으면 옛 INBUCKET_URL 의 호스트를 쓴다", () => {
    assert.deepEqual(
      localMailUpdates({ INBUCKET_URL: "http://localhost:54324" }, MAIL_SETTINGS)[0],
      ["SMTP_HOST", "localhost"],
    );
  });

  it("메일함 주소나 설정을 모르면 빈 목록이다(메일 없이 동작한다)", () => {
    assert.deepEqual(localMailUpdates({}, MAIL_SETTINGS), []);
    assert.deepEqual(localMailUpdates({ MAILPIT_URL: "" }, MAIL_SETTINGS), []);
    assert.deepEqual(localMailUpdates({ MAILPIT_URL: "http://127.0.0.1:54324" }, null), []);
  });

  it("SMTP 로그인 값과 status 의 비밀 값은 싣지 않는다", () => {
    const updates = localMailUpdates(
      { MAILPIT_URL: "http://127.0.0.1:54324", ...SECRETS },
      MAIL_SETTINGS,
    );
    const keys = updates.map(([key]) => key);
    assert.equal(keys.includes("SMTP_USER"), false);
    assert.equal(keys.includes("SMTP_PASSWORD"), false);
    const text = JSON.stringify(updates);
    Object.values(SECRETS).forEach((value) =>
      assert.equal(text.includes(value), false, `${value} 가 실렸다`),
    );
  });
});

describe("unsetMailUpdates — 메일 값은 비어 있을 때만 적는다", () => {
  it("메일 설정이 주석(# KEY=)뿐이거나 빈 값이면 그대로 적는다", () => {
    const example = lines(
      "NEXT_PUBLIC_SUPABASE_URL=",
      "# SMTP_HOST=smtp.example.com",
      "# SMTP_PORT=587",
      "# MAIL_FROM=no-reply@your-domain.com",
      "SMTP_USER=",
      'MAIL_FROM=""',
      "SITE_URL=   # 비워 둠",
    );
    assert.deepEqual(unsetMailUpdates(example, MAIL_UPDATES), MAIL_UPDATES);
  });

  it("파일이 없으면(null) 그대로 적는다", () => {
    assert.deepEqual(unsetMailUpdates(null, MAIL_UPDATES), MAIL_UPDATES);
  });

  it("메일 설정 이름 가운데 하나라도 값이 있으면 아무것도 적지 않는다 — 손으로 적은 진짜 SMTP 를 덮지 않는다", () => {
    for (const line of [
      "SMTP_HOST=smtp.example.com",
      "SMTP_PORT=587",
      "SMTP_USER=mailer",
      "SMTP_PASSWORD=pw-zz-1",
      'MAIL_FROM="팀 <no-reply@example.com>"',
      "export SITE_URL=https://app.example.com",
      "  SMTP_HOST = smtp.example.com",
    ])
      assert.deepEqual(
        unsetMailUpdates(
          lines("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321", line),
          MAIL_UPDATES,
        ),
        [],
        line,
      );
  });

  it("CRLF 파일의 값도 알아본다", () => {
    assert.deepEqual(unsetMailUpdates(crlf("SMTP_HOST=smtp.example.com"), MAIL_UPDATES), []);
  });

  it("메일이 아닌 다른 이름의 값은 판단에 쓰지 않는다", () => {
    assert.deepEqual(
      unsetMailUpdates(
        lines("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321", "SMTP_HOSTNAME=x"),
        MAIL_UPDATES,
      ),
      MAIL_UPDATES,
    );
  });
});
