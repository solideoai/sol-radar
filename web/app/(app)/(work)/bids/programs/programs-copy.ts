// /bids/programs 의 page·loading·error·목록·서랍이 같이 쓰는 주소와 문구(디자인 스펙 §6, h1 은 §12.1 Q1).
// 클라이언트 부품도 부르므로 서버 모듈을 값으로 가져오지 않는다(출처 이름은 시험이 서버 값과 같은지 본다).
import type { ProgramNoticeListItem } from "@/server/program-notices";

export const PROGRAMS_PATH = "/bids/programs";
export const PROGRAMS_TITLE = "부처 지원사업 공고";
export const PROGRAMS_DESCRIPTION =
  "기업마당·중기부 지원사업은 IT 관련 공고만, 과기정통부 R&D 신규 공모는 모두 보입니다. SOL Score와 권고는 계산하지 않습니다.";
export const PROGRAMS_LOADING = "부처 지원사업 공고를 불러오는 중…";

export const SOURCE_LABEL: Record<ProgramNoticeListItem["source"], string> = {
  bizinfo: "기업마당",
  mss: "중기부",
  msit: "과기정통부",
};

export const TABLE_CAPTION = "부처 지원사업 공고 목록. 공고명을 누르면 상세가 열립니다.";
export const CAPPED_NOTE = " · 최대 300건까지 보입니다. 출처나 소관기관으로 좁혀 보세요";

export const NO_PERIOD = "기간 미표기";
// 과기정통부 응답에는 신청 기간이 없다. 기간은 첨부 공고문에만 있다.
export const CHECK_NOTICE_FILE = "공고문 확인";

/** 마감·신청 기간이 없을 때의 표기. 과기정통부는 "공고문 확인", 나머지는 "기간 미표기"다. */
export const noPeriodText = (source: ProgramNoticeListItem["source"]): string =>
  source === "msit" ? CHECK_NOTICE_FILE : NO_PERIOD;
export const NO_AGENCY = "소관기관 미표기";
export const CLOSED_HIDDEN = "마감 지난 공고는 숨겨져 있습니다.";
export const INCLUDE_CLOSED_LABEL = "마감 지난 공고 포함";
export const RESET_FILTERS_LABEL = "필터 초기화";

export const EMPTY_COPY = {
  none: {
    title: "수집된 IT 관련 부처 지원사업 공고가 없습니다",
    description: "부처 공고는 정해진 주기로 자동 수집됩니다.",
    action: "나라장터 공고 보기",
  },
  open: { title: "진행 중인 IT 관련 부처 지원사업 공고가 없습니다" },
  filtered: { title: "조건에 맞는 공고가 없습니다" },
} as const;

export const DRAWER_COPY = {
  period: "신청 기간",
  published: "등록일",
  source: "원문 보기",
  contact: "문의처는 원문에서 확인하세요",
  summary: "사업개요",
  applyMethod: "신청방법",
  target: "지원대상",
  tags: "분야·태그",
  titleOnly: "이 출처는 제목과 등록일만 제공합니다. 사업 내용과 신청 기간은 원문에서 확인하세요.",
  titleOnlyMsit:
    "이 출처는 제목·등록일·담당 부서만 제공합니다. 신청 기간과 사업 내용은 원문의 첨부 공고문에서 확인하세요.",
} as const;
