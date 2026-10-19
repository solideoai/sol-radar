import "server-only";
import { z } from "zod";

// 05 §4.6 Notification
export const notificationSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum([
    "BID_CREATED",
    "BID_CHANGED",
    "DEADLINE_APPROACHING",
    "ANALYSIS_COMPLETE",
    "REVIEW_ASSIGNED",
  ]),
  channel: z.enum(["IN_APP", "KAKAO"]),
  status: z.enum(["PENDING", "SENT", "FAILED", "DEAD"]),
  payload: z.strictObject({
    bidId: z.string().min(1),
    title: z.string(),
    message: z.string(),
    link: z.string(),
    changedFields: z.array(z.string()).optional(),
  }),
  readAt: z.string().nullable(),
  createdAt: z.string().min(1),
});
export type Notification = z.infer<typeof notificationSchema>;
