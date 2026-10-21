import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { IngestionSourceCard, IngestionSourceFailure } from "@/server/ingestion";
import { SourceCards } from "./source-cards";

// 소스별 최근 수집 카드(N8 디자인 스펙 §4.4·§7·§9)를 진짜 브라우저에 그린다.
// 단 폭은 본문 960(1280·펼침)·1120(1440·펼침)·1216(1280·접힘)·1376(1440·접힘)에서 잰다(스펙 §3.2).

const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (node: React.ReactNode, width = 960) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

// 서울 2026-10-20 14:03:30. 마지막 성공(13:51:12)에서 12분 뒤다.
const NOW = "2026-10-20T05:03:30.000Z";

const FIXTURE_CARD: IngestionSourceCard = {
  source: "fixture",
  lastSuccess: {
    runId: "a1000000-0000-4000-8000-0000000000a1",
    status: "PARTIAL",
    finishedAt: "2026-10-20T04:51:12.000Z",
    created: 19,
    changed: 0,
    quarantined: 1,
  },
  lastFailure: null,
};
// 경고(공고는 적재됨) 뒤에 run 을 멈춘 공공 API 오류. 카드는 경고가 아니라 중단 원인을 보인다.
const G2B_FAILURE: IngestionSourceFailure = {
  runId: "f1000000-0000-4000-8000-0000000000f1",
  finishedAt: "2026-10-20T05:00:03.000Z",
  errors: [
    {
      sourceKey: "g2b:R26BK00000001",
      errorCode: "BUDGET_UNPARSED",
      resultCode: null,
      detail: "budget: 미정",
    },
    {
      sourceKey: "g2b:page:start",
      errorCode: "API_SERVICE_KEY_INVALID",
      resultCode: "30",
      detail: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
    },
  ],
};
const G2B_CARD: IngestionSourceCard = {
  source: "g2b",
  lastSuccess: {
    runId: "b1000000-0000-4000-8000-0000000000b1",
    status: "SUCCEEDED",
    finishedAt: "2026-10-19T00:10:00.000Z",
    created: 3,
    changed: 0,
    quarantined: 0,
  },
  lastFailure: G2B_FAILURE,
};
const EMPTY_G2B: IngestionSourceCard = { source: "g2b", lastSuccess: null, lastFailure: null };

const view = (
  cards: readonly IngestionSourceCard[],
  runMode: "mock" | "fixture" | "live" = "mock",
) => <SourceCards cards={cards} runMode={runMode} now={NOW} />;

const cardsOf = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>("[data-slot='card']"),
];
const cardOf = (host: HTMLElement, title: string): HTMLElement => {
  const found = cardsOf(host).find((card) => card.querySelector("h3")?.textContent === title);
  if (found === undefined) throw new Error(`카드 ${title} 가 없다`);
  return found;
};
// dt 글자 → dd 요소
const termsOf = (card: HTMLElement): Map<string, HTMLElement> =>
  new Map(
    [...card.querySelectorAll<HTMLElement>("dt")].map((dt) => [
      dt.textContent ?? "",
      dt.nextElementSibling as HTMLElement,
    ]),
  );
const valueOf = (card: HTMLElement, term: string): HTMLElement => {
  const dd = termsOf(card).get(term);
  if (dd === undefined) throw new Error(`${term} 줄이 없다`);
  return dd;
};

// truncate 가 의도인 요소와 화면 읽기 프로그램 전용 글자(sr-only)는 뺀다(company-profile-view 시험과 같다).
const spilled = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("*")]
    .filter(
      (element) =>
        !element.classList.contains("truncate") && !element.classList.contains("sr-only"),
    )
    .filter((element) => element.scrollWidth > element.clientWidth + 1)
    .map((element) => `${element.tagName}.${element.className.slice(0, 40)}`);

describe("SourceCards — 구역과 순서", () => {
  it("h2 '소스별 최근 수집' 아래 h3 카드 두 장이 데모 데이터 → 나라장터 순서다(받은 순서가 거꾸로여도)", () => {
    const host = render(view([G2B_CARD, FIXTURE_CARD]));

    const section = host.querySelector("section");
    expect(section?.getAttribute("aria-labelledby")).toBe("ingest-sources-title");
    expect(host.querySelector("h2")?.textContent).toBe("소스별 최근 수집");
    expect(cardsOf(host).map((card) => card.querySelector("h3")?.textContent)).toStrictEqual([
      "데모 데이터 (fixture)",
      "나라장터 (g2b)",
    ]);
  });

  it("카드가 오지 않은 소스도 자리를 지키고 '수집 기록이 없습니다'를 보인다", () => {
    const host = render(view([FIXTURE_CARD]));

    expect(cardsOf(host)).toHaveLength(2);
    const g2b = cardOf(host, "나라장터 (g2b)");
    expect(g2b.textContent).toContain("수집 기록이 없습니다");
    expect(g2b.querySelector("dl")).toBeNull();
  });

  it("카드 안에는 초점을 받는 요소가 없다(동작 없음, §7)", () => {
    const host = render(view([FIXTURE_CARD, G2B_CARD]));

    expect(host.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });
});

describe("SourceCards — 실행 가능 줄", () => {
  it("실행 모드 mock: 데모 데이터는 지금 모드에서 되고, 나라장터는 live 에서만 된다", () => {
    const host = render(view([FIXTURE_CARD, G2B_CARD], "mock"));

    expect(cardOf(host, "데모 데이터 (fixture)").textContent).toContain(
      "실행 모드 mock에서 실행할 수 있습니다",
    );
    expect(cardOf(host, "나라장터 (g2b)").textContent).toContain(
      "실행 모드 live에서만 실행할 수 있습니다",
    );
  });

  it("실행 모드 live: 나라장터는 지금 모드에서 되고, 데모 데이터는 fixture·mock 에서만 된다", () => {
    const host = render(view([FIXTURE_CARD, G2B_CARD], "live"));

    expect(cardOf(host, "데모 데이터 (fixture)").textContent).toContain(
      "실행 모드 fixture·mock에서만 실행할 수 있습니다",
    );
    expect(cardOf(host, "나라장터 (g2b)").textContent).toContain(
      "실행 모드 live에서 실행할 수 있습니다",
    );
  });
});

describe("SourceCards — 네 줄", () => {
  it("마지막 성공은 서울 시각 · 상대 시각이고 <time> 에 UTC 원값을 단다. 적재·격리는 그 run 의 숫자다", () => {
    const card = cardOf(render(view([FIXTURE_CARD, G2B_CARD])), "데모 데이터 (fixture)");

    expect([...termsOf(card).keys()]).toStrictEqual(["마지막 성공", "마지막 실패", "적재", "격리"]);
    const success = valueOf(card, "마지막 성공");
    expect(success.textContent).toBe("2026-10-20 13:51 · 12분 전");
    const time = success.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-10-20T04:51:12.000Z");
    expect(time?.getAttribute("title")).toBe("2026-10-20T04:51:12.000Z");
    expect(valueOf(card, "적재").textContent).toBe("신규 19 · 변경 0");
    expect(valueOf(card, "격리").textContent).toBe("1건");
  });

  it("실패가 없으면 '마지막 실패 없음'이고 빨간 글자·아이콘이 없다", () => {
    const failure = valueOf(
      cardOf(render(view([FIXTURE_CARD, G2B_CARD])), "데모 데이터 (fixture)"),
      "마지막 실패",
    );

    expect(failure.textContent).toBe("없음");
    expect(failure.classList.contains("text-destructive")).toBe(false);
    expect(failure.querySelector("svg")).toBeNull();
  });

  it("마지막 실패는 서울 시각 · 중단 원인 라벨 코드다(경고가 아니라 run 을 멈춘 오류를 고른다)", () => {
    const failure = valueOf(
      cardOf(render(view([FIXTURE_CARD, G2B_CARD])), "나라장터 (g2b)"),
      "마지막 실패",
    );

    expect(failure.textContent).toBe(
      "2026-10-20 14:00 · 공공 API 서비스키 거부 (키 값은 보이지 않습니다) API_SERVICE_KEY_INVALID",
    );
    expect(failure.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-10-20T05:00:03.000Z",
    );
  });

  it("실패 값은 destructive 글자색이고 14px 아이콘(낭독 제외)을 앞에 둔다", () => {
    const failure = valueOf(
      cardOf(render(view([FIXTURE_CARD, G2B_CARD])), "나라장터 (g2b)"),
      "마지막 실패",
    );
    const probe = document.body.appendChild(document.createElement("span"));
    probe.className = "text-destructive";

    expect(getComputedStyle(failure).color).toBe(getComputedStyle(probe).color);
    const icon = failure.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    const box = icon?.getBoundingClientRect();
    expect([box?.width, box?.height]).toStrictEqual([14, 14]);
  });

  it("오류 행이 없는 실패 run 은 시각만 보인다", () => {
    const failure = valueOf(
      cardOf(
        render(view([FIXTURE_CARD, { ...G2B_CARD, lastFailure: { ...G2B_FAILURE, errors: [] } }])),
        "나라장터 (g2b)",
      ),
      "마지막 실패",
    );

    expect(failure.textContent).toBe("2026-10-20 14:00");
  });

  it("성공 run 이 없고 실패만 있으면 마지막 성공은 '없음', 적재·격리는 '—' 다", () => {
    const card = cardOf(
      render(view([FIXTURE_CARD, { ...G2B_CARD, lastSuccess: null }])),
      "나라장터 (g2b)",
    );

    expect(valueOf(card, "마지막 성공").textContent).toBe("없음");
    expect(valueOf(card, "적재").textContent).toBe("—");
    expect(valueOf(card, "격리").textContent).toBe("—");
  });

  it("두 소스 모두 run 이 없으면 두 카드 모두 '수집 기록이 없습니다'이고 네 줄을 그리지 않는다(§4.10 빈 목록)", () => {
    const host = render(view([{ ...EMPTY_G2B, source: "fixture" }, EMPTY_G2B]));

    expect(
      cardsOf(host).map((card) => card.textContent?.includes("수집 기록이 없습니다")),
    ).toStrictEqual([true, true]);
    expect(host.querySelectorAll("dl")).toHaveLength(0);
  });
});

describe("SourceCards — 단 폭(§3.2·§9)", () => {
  it.each([960, 1120, 1216, 1376])(
    "%ipx 단에서 카드가 한 줄 2칸이고, 긴 중단 원인도 가로로 넘치지 않는다",
    (width) => {
      const host = render(view([FIXTURE_CARD, G2B_CARD]), width);

      const [first, second] = cardsOf(host).map((card) => card.getBoundingClientRect());
      expect(first?.top).toBe(second?.top);
      expect(second?.left).toBeGreaterThan(first?.right ?? Number.POSITIVE_INFINITY);
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
      expect(spilled(host)).toStrictEqual([]);
    },
  );
});
