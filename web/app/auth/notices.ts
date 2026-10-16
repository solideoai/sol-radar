// 계정 화면이 함께 쓰는 안내 문구. 클라이언트 부품("use client")에서 내보낸 값은 서버 화면에서 글자가 아니라 참조가 되므로 여기 둔다.

// 정지된 계정은 Supabase Auth 가 user_banned 로 거절한다(비밀번호 로그인, 간편 로그인의 ?link=suspended).
export const SUSPENDED_NOTICE = "정지된 계정이라 로그인할 수 없습니다. 운영자에게 문의해 주세요.";
