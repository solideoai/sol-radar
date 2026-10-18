import { AppPage } from "@/components/app-page";
import { PeoplePending, PeopleViewNav } from "@/components/people/people-directory";
export default function PeopleLoading() {
  return (
    <AppPage title="조직·인력">
      <PeopleViewNav query="" view="list" />
      <PeoplePending />
    </AppPage>
  );
}
