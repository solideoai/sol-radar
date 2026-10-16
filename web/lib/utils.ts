export { cn } from "cn";

// 아바타·조직 표시에 넣을 머리글자. 이모지처럼 두 칸짜리 글자가 반으로 잘리지 않게 코드 포인트 단위로 뗀다.
export const initialOf = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() ?? "";
