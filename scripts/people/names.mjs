/** @typedef {"MALE"|"FEMALE"} Gender */

// Actual two-syllable given names from the first 50 rows of Namechart, verified
// by the controller on 2026-10-16. Reference usage only, never birth years/ages.
// https://www.namechart.kr/chart/2008?gender=m
// https://www.namechart.kr/chart/2008?gender=f
const GIVEN_NAMES = {
  MALE: "민준 지훈 현우 준서 우진 건우 예준 준혁 현준 동현 도현 민재 승현 서준 민성 승민 시우 준영 정우 지호 준우 지환 서진 민규 성민 지원 성현 지후 은찬 한결 지민 진우 승우 재민 현서 재원 민석 재현 민혁 도윤 민서 유찬 준호 정민 민우 정현 태현 승준 민찬 현수".split(
    " ",
  ),
  FEMALE:
    "서연 민서 지민 서현 서윤 예은 하은 수빈 지우 윤서 유진 은서 예진 지윤 민지 예원 지원 서영 수민 가은 채원 수아 수연 다은 채은 예린 현서 유빈 지현 민주 서진 소연 지은 시은 다연 수현 윤지 소윤 현지 예빈 윤아 은채 나연 지수 예서 예지 혜원 나영 은지 연우".split(
      " ",
    ),
};
const SURNAMES = "김 이 박 최 정 강 조 윤 장 임 한 오 서 신 권 황 안 송 전 홍".split(" ");

/** Remove source annotations while callers retain raw names in memory as well. */
export function normalizeSourceName(value) {
  return value.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, "").replace(/\s+/g, "");
}

/**
 * Select whole surname/given-name combinations in a fixed, surname-balanced order.
 * On success reserve names in the shared usedNames set; on failure leave it intact.
 * @param {{gender:Gender,count:number,excludedNames:Set<string>,usedNames:Set<string>}} options
 * @returns {string[]}
 */
export function selectNames({ gender, count, excludedNames, usedNames }) {
  if (
    !Object.hasOwn(GIVEN_NAMES, gender) ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !(excludedNames instanceof Set) ||
    !(usedNames instanceof Set)
  )
    throw new Error("Invalid name request");
  const blocked = new Set([...excludedNames, ...usedNames].map(normalizeSourceName));
  const givenNames = GIVEN_NAMES[gender];
  const candidates = givenNames.flatMap((_, round) =>
    SURNAMES.map((surname, index) => surname + givenNames[(round + index) % givenNames.length]),
  );
  const selected = candidates
    .filter((name) => name[0] !== name[1] && !blocked.has(name))
    .slice(0, count);
  if (selected.length !== count) throw new Error("Name candidates exhausted");
  for (const name of selected) usedNames.add(name);
  return selected;
}
