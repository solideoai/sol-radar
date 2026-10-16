import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { getUserList, USER_SEARCH_MAX_LENGTH } from "@/server/admin";
import { UserList } from "./user-list";

export const metadata: Metadata = { title: "사용자 관리" };

// 잘못된 쿼리 값은 도메인(@/server/admin)이 기본값으로 바꾼다.
export default async function AdminUsersPage({ searchParams }: PageProps<"/admin">) {
  await connection();
  const result = await getUserList(await searchParams);
  // 처음 여는 요청은 틀(layout)이 먼저 막는다. 여기는 보는 사이 운영자에서 빠진 뒤의 이동(검색·쪽)을 막는다.
  if (result.status !== "ready") notFound();

  return (
    <AppPage
      title="사용자 관리"
      description="가입한 모든 사용자를 보고, 회원의 이용을 정지하거나 해제합니다."
    >
      <UserList list={result.list} searchMaxLength={USER_SEARCH_MAX_LENGTH} />
    </AppPage>
  );
}
