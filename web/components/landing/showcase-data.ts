// 첫 화면의 흐르는 줄 둘(솔리데오 수행 서비스, 데이터 출처)과 녹화 영상의 자료 목록(스펙 2026-10-28-ui-refresh §4.5).
// 그림은 public/landing/ 아래 원본이다. width·height 는 그 파일의 실제 크기(px)이고 화면은 높이를 맞춰 줄인다.

export type SolideoService = { name: string; image: string; width: number; height: number };

// collecting: 운영에서 실제 공고를 수집하는 기관(꼬리표 없음). planned: 아직 수집하지 않는 기관("연결 예정").
// 값은 운영 수집 기록으로 정한다(스펙 U6). 확인 전 기본값은 나라장터만 collecting 이다.
export type DataSource = {
  name: string;
  logo: { src: string; width: number; height: number } | null;
  status: "collecting" | "planned";
};

// 솔리데오 누리집의 공공 서비스 17개(https://www.solideos.com/portal/govSM.do), 그 순서다.
// 그림은 그 페이지의 서비스 그림을 webp 로 바꾸고 투명 여백만 잘랐다.
export const SOLIDEO_SERVICES: readonly SolideoService[] = [
  { name: "정부24", image: "/landing/services/gov24.webp", width: 149, height: 50 },
  { name: "건축행정시스템 세움터", image: "/landing/services/eais.webp", width: 161, height: 54 },
  { name: "보조금24", image: "/landing/services/bojo24.webp", width: 157, height: 50 },
  { name: "정부 전자문서지갑", image: "/landing/services/doc-wallet.webp", width: 218, height: 44 },
  { name: "공공 마이데이터", image: "/landing/services/mydata.webp", width: 216, height: 50 },
  {
    name: "행정정보공동이용시스템",
    image: "/landing/services/info-sharing.webp",
    width: 221,
    height: 37,
  },
  {
    name: "시도 행정정보시스템",
    image: "/landing/services/sido-admin.webp",
    width: 190,
    height: 41,
  },
  { name: "새올 행정시스템", image: "/landing/services/saeol.webp", width: 150, height: 53 },
  { name: "건축HUB포털", image: "/landing/services/hub-portal.webp", width: 218, height: 80 },
  { name: "렌트홈", image: "/landing/services/renthome.webp", width: 111, height: 57 },
  { name: "의약품안전나라", image: "/landing/services/nedrug.webp", width: 143, height: 72 },
  { name: "마이홈", image: "/landing/services/myhome.webp", width: 121, height: 52 },
  { name: "식품안전나라", image: "/landing/services/foodsafety.webp", width: 204, height: 25 },
  { name: "소상공인24", image: "/landing/services/sbiz24.webp", width: 216, height: 53 },
  {
    name: "식의약품 종합정보시스템",
    image: "/landing/services/mfds-info.webp",
    width: 250,
    height: 50,
  },
  {
    name: "건축물 생애이력 관리시스템",
    image: "/landing/services/building-life.webp",
    width: 190,
    height: 82,
  },
  {
    name: "청주시 굿모닝행정포털",
    image: "/landing/services/cheongju-portal.webp",
    width: 203,
    height: 43,
  },
];

// 공고를 가져오는 곳 9곳. 공공데이터포털은 넣지 않는다 — 나라장터·K-water 등이 거쳐 오는 창구라 같은 출처를 두 번 센다.
// 로고는 각 기관 공식 CI 안내 페이지의 파일에서 로고 부분만 꺼냈다(그림은 바꾸지 않는다). 공식 파일을 못 구한 곳은 null 이고 이름 글자만 보인다.
// 기관 이름 글자가 함께 보이므로, 이름이 든 시그니처보다 마크·워드마크를 고른다(나라장터는 국문 이름이 없는 영문 상표 KONEPS).
export const DATA_SOURCES: readonly DataSource[] = [
  {
    name: "나라장터(조달청)",
    logo: { src: "/landing/sources/koneps.svg", width: 304, height: 95 },
    status: "collecting",
  },
  {
    name: "한국토지주택공사",
    logo: { src: "/landing/sources/lh.svg", width: 35, height: 24 },
    status: "planned",
  },
  {
    name: "한국수자원공사",
    logo: { src: "/landing/sources/kwater.png", width: 281, height: 127 },
    status: "planned",
  },
  {
    name: "한국전력공사",
    logo: { src: "/landing/sources/kepco.svg", width: 171, height: 109 },
    status: "planned",
  },
  { name: "기업마당", logo: null, status: "planned" },
  { name: "중소벤처기업부", logo: null, status: "planned" },
  {
    name: "한국도로공사",
    logo: { src: "/landing/sources/ex.svg", width: 301, height: 91 },
    status: "planned",
  },
  { name: "국방전자조달", logo: null, status: "planned" },
  {
    name: "한국철도공사",
    logo: { src: "/landing/sources/korail.svg", width: 284, height: 49 },
    status: "planned",
  },
];

// 첫 화면 녹화 영상. 새 화면이 운영에 배포된 뒤 녹화해 채운다. null 이면 영상 구역을 그리지 않는다.
export const LANDING_VIDEO: { webm: string; mp4: string; poster: string } | null = null;
