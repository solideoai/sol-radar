export { cn } from "cn";

// 아바타·조직 표시에 넣을 머리글자. 이모지처럼 두 칸짜리 글자가 반으로 잘리지 않게 코드 포인트 단위로 뗀다.
export const initialOf = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() ?? "";

// 화면에 보이는 이메일을 가린다. 아이디 첫 글자만 두고 나머지 아이디는 *, @ 뒤 도메인은 그대로 둔다.
export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  const domain = at === -1 ? "" : email.slice(at);
  const [first = "", ...rest] = Array.from(local);
  return `${first}${"*".repeat(rest.length)}${domain}`;
};
