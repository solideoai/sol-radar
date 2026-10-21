import { describe, expect, it } from "vitest";
import { cleanText, dedupeKeyOf, htmlToPlainText, maskContacts } from "./text";

describe("htmlToPlainText", () => {
  it("태그를 걷고 문단·줄바꿈 태그는 줄바꿈으로 바꾼다", () => {
    expect(htmlToPlainText("<p>가</p><p>나<br/>다</p>&amp;&lt;b&gt;")).toBe("가\n나\n다\n&<b>");
  });

  it("script·style 은 내용째 뺀다", () => {
    expect(htmlToPlainText("앞<script>alert(1)</script><style>p{}</style>뒤")).toBe("앞뒤");
  });

  it("숫자 문자 참조와 &nbsp; 를 푼다", () => {
    expect(htmlToPlainText("&#44032;&#x B; &nbsp;끝")).toBe("가&#x B; 끝");
    expect(htmlToPlainText("&#x41;&#66;")).toBe("AB");
  });

  it("빈 줄이 여럿이면 하나로 줄이고 줄 끝 공백을 걷는다", () => {
    expect(htmlToPlainText("가  \n\n\n\n나<br><br><br>다")).toBe("가\n\n나\n\n다");
  });
});

describe("maskContacts", () => {
  it("전화·이메일·대표번호를 같은 길이의 * 로 바꾼다", () => {
    expect(maskContacts("문의 02-123-4567, a.b@x.go.kr, 1588-1234")).toBe(
      "문의 ***********, ***********, *********",
    );
  });

  it("날짜·금액은 그대로 둔다", () => {
    expect(maskContacts("2026-10-21 까지, 1,000-2,000만원")).toBe(
      "2026-10-21 까지, 1,000-2,000만원",
    );
    expect(maskContacts("1500-2000만원, 1998-2026년")).toBe("1500-2000만원, 1998-2026년");
  });

  it("번호 바로 뒤에 쉼표·마침표가 와도 가린다", () => {
    expect(maskContacts("02-123-4567, 1588-1234.")).toBe("***********, *********.");
  });
});

describe("cleanText", () => {
  it("평문화·가림·trim 을 하고 빈 값은 null 이다", () => {
    expect(cleanText("<p> 문의 010-1234-5678 </p>", 100)).toBe("문의 *************");
    expect(cleanText("   ", 100)).toBeNull();
    expect(cleanText(undefined, 100)).toBeNull();
    expect(cleanText(42, 100)).toBeNull();
  });

  it("상한을 넘으면 자르고 말줄임표를 붙인다", () => {
    expect(cleanText("가나다라마", 3)).toBe("가나다…");
  });
});

describe("dedupeKeyOf", () => {
  it("머리말 대괄호·공백·구두점·전각 차이를 무시한다", () => {
    expect(dedupeKeyOf("[중기부] 2026년 스마트공장 지원사업 공고", "중소벤처기업부")).toBe(
      dedupeKeyOf("2026년  스마트공장 지원사업 공고.", "중소벤처기업부 "),
    );
    expect(dedupeKeyOf("ＡＢＣ 사업", null)).toBe(dedupeKeyOf("abc사업", null));
  });

  it("소관기관이 다르면 다른 키다", () => {
    expect(dedupeKeyOf("같은 제목", "중소벤처기업부")).not.toBe(
      dedupeKeyOf("같은 제목", "산업통상자원부"),
    );
  });
});
