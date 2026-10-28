import {
  BadgeCheckIcon,
  FileInputIcon,
  FileTextIcon,
  FolderKanbanIcon,
  HandshakeIcon,
  MailOpenIcon,
  MapPinIcon,
} from "lucide-react";
import type { CalendarEventKind } from "@/server/calendar";

// 일정 종류는 색이 아니라 아이콘과 글자로 구분한다. 달력 칩·거르기 칩·다가오는 목록이 같은 아이콘을 쓴다.
export const KIND_ICON: Record<CalendarEventKind, typeof FileTextIcon> = {
  SUBMISSION_DUE: FolderKanbanIcon,
  BID_DEADLINE: FileTextIcon,
  BID_BEGIN: FileInputIcon,
  QUALIFICATION_DUE: BadgeCheckIcon,
  JOINT_AGREEMENT_DUE: HandshakeIcon,
  SITE_BRIEFING: MapPinIcon,
  OPENING: MailOpenIcon,
};
