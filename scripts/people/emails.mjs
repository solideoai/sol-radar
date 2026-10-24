// 가상 인물 회사 메일: 성을 뺀 이름 + 성(관용 로마자, 소문자) @ 회사 도메인.
// 2026-10-24 사용자 결정. 예: 김민준 → minjunkim@solideos.com. 그래도 겹치면 직원 번호 순으로 2·3…을 붙인다.
export const EMAIL_DOMAIN = "solideos.com";

// names.mjs 의 성 목록과 같은 순서다. 흔히 쓰는 관용 표기를 따른다.
const SURNAMES = {
  김: "kim",
  이: "lee",
  박: "park",
  최: "choi",
  정: "jung",
  강: "kang",
  조: "cho",
  윤: "yoon",
  장: "jang",
  임: "lim",
  한: "han",
  오: "oh",
  서: "seo",
  신: "shin",
  권: "kwon",
  황: "hwang",
  안: "ahn",
  송: "song",
  전: "jeon",
  홍: "hong",
};

// names.mjs 의 이름 후보 전부(남녀 공통 이름은 한 번). 음절 조합이 아니라 이름 단위로 고정한다.
const GIVEN_NAMES = {
  민준: "minjun",
  지훈: "jihoon",
  현우: "hyunwoo",
  준서: "junseo",
  우진: "woojin",
  건우: "geonwoo",
  예준: "yejun",
  준혁: "junhyuk",
  현준: "hyunjun",
  동현: "donghyun",
  도현: "dohyun",
  민재: "minjae",
  승현: "seunghyun",
  서준: "seojun",
  민성: "minsung",
  승민: "seungmin",
  시우: "siwoo",
  준영: "junyoung",
  정우: "jungwoo",
  지호: "jiho",
  준우: "junwoo",
  지환: "jihwan",
  서진: "seojin",
  민규: "mingyu",
  성민: "sungmin",
  지원: "jiwon",
  성현: "sunghyun",
  지후: "jihoo",
  은찬: "eunchan",
  한결: "hangyeol",
  지민: "jimin",
  진우: "jinwoo",
  승우: "seungwoo",
  재민: "jaemin",
  현서: "hyunseo",
  재원: "jaewon",
  민석: "minseok",
  재현: "jaehyun",
  민혁: "minhyuk",
  도윤: "doyoon",
  민서: "minseo",
  유찬: "yuchan",
  준호: "junho",
  정민: "jungmin",
  민우: "minwoo",
  정현: "junghyun",
  태현: "taehyun",
  승준: "seungjun",
  민찬: "minchan",
  현수: "hyunsoo",
  서연: "seoyeon",
  서현: "seohyun",
  서윤: "seoyoon",
  예은: "yeeun",
  하은: "haeun",
  수빈: "soobin",
  지우: "jiwoo",
  윤서: "yoonseo",
  유진: "yujin",
  은서: "eunseo",
  예진: "yejin",
  지윤: "jiyoon",
  민지: "minji",
  예원: "yewon",
  서영: "seoyoung",
  수민: "soomin",
  가은: "gaeun",
  채원: "chaewon",
  수아: "sooah",
  수연: "sooyeon",
  다은: "daeun",
  채은: "chaeeun",
  예린: "yerin",
  유빈: "yubin",
  지현: "jihyun",
  민주: "minju",
  소연: "soyeon",
  지은: "jieun",
  시은: "sieun",
  다연: "dayeon",
  수현: "soohyun",
  윤지: "yoonji",
  소윤: "soyoon",
  현지: "hyunji",
  예빈: "yebin",
  윤아: "yoona",
  은채: "eunchae",
  나연: "nayeon",
  지수: "jisoo",
  예서: "yeseo",
  예지: "yeji",
  혜원: "hyewon",
  나영: "nayoung",
  은지: "eunji",
  연우: "yeonwoo",
};

/** 세 글자 이름(성 한 글자 + 이름 두 글자)을 메일 앞부분으로 바꾼다. 표에 없는 이름은 거절한다. */
export function emailLocalPart(name) {
  const surname = SURNAMES[name?.[0]];
  const given = GIVEN_NAMES[name?.slice(1)];
  if (typeof name !== "string" || name.length !== 3 || !surname || !given)
    throw new Error("Unknown synthetic name");
  return `${given}${surname}`;
}

/** 명부 순서(직원 번호 순)대로 메일을 정한다. 같은 앞부분이 다시 나오면 2부터 번호를 붙인다. */
export function assignEmails(people) {
  const taken = new Set();
  return people.map((person) => {
    const base = emailLocalPart(person.name);
    let local = base;
    for (let suffix = 2; taken.has(local); suffix++) local = `${base}${suffix}`;
    taken.add(local);
    // fixture 키 순서를 고정하려고 email 을 name 바로 뒤에 둔다.
    return Object.fromEntries(
      Object.entries(person)
        .filter(([key]) => key !== "email")
        .flatMap((entry) =>
          entry[0] === "name" ? [entry, ["email", `${local}@${EMAIL_DOMAIN}`]] : [entry],
        ),
    );
  });
}
