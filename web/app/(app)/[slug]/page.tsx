import { redirect } from "next/navigation";

// 멤버인지는 대시보드가 확인한다.
export default async function OrgHomePage({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  redirect(`/${slug}/dashboard`);
}
