import "server-only";
import { cache } from "react";
import { getMyBusinessAccess } from "@/server/organization";
import { getMyProfile } from "@/server/profile";

// 틀(layout)과 화면(page)이 같은 요청에서 내 프로필·업무 조직을 저마다 확인한다. cache 로 렌더 한 번에 한 번만 읽는다
// (Supabase 왕복이 화면마다 두 벌씩 나갔다). 렌더 안에서는 고친 뒤 다시 읽는 일이 없어 처음 읽은 값을 같이 써도 된다.
// 서버 함수·라우트 핸들러는 렌더가 아니라서 이 감싸기가 아무 일도 하지 않고 부를 때마다 새로 읽는다
// (web/node_modules/next/dist/docs/01-app/02-guides/authentication.md "Good to know").
export const loadMyProfile = cache(() => getMyProfile());
export const loadMyBusinessAccess = cache(() => getMyBusinessAccess());
