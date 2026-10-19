import "server-only";

// ── 15 §5.1 norm(s): 인용 오프셋과 추출기 입력이 같은 텍스트를 보도록 하는 정규화 ──
const ZERO_WIDTH = /[​‌‍﻿]/g;
const WHITESPACE_RUN = /\s+/g;
const FULLWIDTH_PUNCTUATION = /[（）［］｛｝＂＇，]/g;
const HALFWIDTH_OF: Readonly<Record<string, string>> = {
  "（": "(",
  "）": ")",
  "［": "[",
  "］": "]",
  "｛": "{",
  "｝": "}",
  "＂": '"',
  "＇": "'",
  "，": ",",
};

export function normText(input: string): string {
  const compatible = input.normalize("NFKC");
  // 제로폭 문자를 먼저 지워야 그 양옆 공백이 한 덩어리로 합쳐진다.
  const visible = compatible.replace(ZERO_WIDTH, "");
  const collapsed = visible.replace(WHITESPACE_RUN, " ").trim();
  // NFKC 가 대부분 바꾸지만, 정규화를 거치지 않은 문자열이 섞여도 결과가 같도록 한 번 더 바꾼다.
  return collapsed.replace(FULLWIDTH_PUNCTUATION, (char) => HALFWIDTH_OF[char] ?? char);
}
