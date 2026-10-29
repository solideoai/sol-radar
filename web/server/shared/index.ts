// 배럴: 도메인 여럿이 같이 쓰는 코드. 이 층은 아무것도 import 하지 않는다(브라우저에서도 돌 수 있게).
export { AUTH_COOKIE_OPTIONS } from "./auth-cookie";
export { nameOf } from "./display-name";
export { errorNameOf } from "./error-name";
export { FACTOR_LABEL } from "./factor-label";
export {
  reportBrowserError,
  reportServerError,
  toBrowserErrorRecord,
  toServerErrorRecord,
} from "./error-report";
export type { ErrorRecord, ServerErrorContext, ServerErrorRequest } from "./error-report";
export {
  employmentInfoSchema,
  employmentInputSchema,
  employmentNameSchema,
  employmentSelectionSchema,
  employmentStateSchema,
  optionItemSchema,
  signupOptionsSchema,
} from "./employment";
export type {
  EmploymentInfo,
  EmploymentInput,
  EmploymentSelection,
  EmploymentState,
  OptionItem,
  SignupOptions,
} from "./employment";
export { reviewDecisionSchema, reviewInputSchema, reviewReasonSchema } from "./review-input";
export type { ReviewDecision, ReviewInput } from "./review-input";
export {
  RECOMMENDATION_LABEL,
  recommendationWithObject,
  relabelLegacyExplanation,
} from "./recommendation-label";
export {
  PHOTO_BUCKET,
  PHOTO_INPUT_MAX_BYTES,
  PHOTO_INPUT_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_SIZE_PX,
  isMemberPhotoPath,
  isOwnPhotoPath,
} from "./profile-photo";
