import Link from "next/link";
import { AppPage } from "@/components/app-page";
export default function NotFound() {
  return (
    <AppPage
      title="프로젝트를 찾을 수 없습니다"
      description="프로젝트가 없거나 조회할 수 없습니다."
    >
      <Link href="/projects" className="type-body underline">
        프로젝트 목록으로
      </Link>
    </AppPage>
  );
}
