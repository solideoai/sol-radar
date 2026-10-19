import { PeopleReadLayout } from "@/app/_lib/people-read-layout";
export default function OrgChartLayout({ children }: { children: React.ReactNode }) {
  return PeopleReadLayout({ children, title: "조직도" });
}
