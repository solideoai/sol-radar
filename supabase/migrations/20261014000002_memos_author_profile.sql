-- 20261014000002_memos_author_profile — 메모의 작성자(user_id)가 profiles 를 가리키게 한다.
--
-- 팀 메모는 작성자 이름을 같이 보인다. 외래 키가 public 표끼리여야 한 질의로 작성자 프로필을 붙여 읽고
-- (memos → profiles), 생성 타입에도 관계가 생긴다. 같은 조직 멤버의 프로필은 정책이 열어 두었고,
-- 떠난 멤버의 프로필은 읽지 못해 비어 온다(화면이 "떠난 멤버"로 보인다).
--
-- 지우는 동작은 그대로다: 계정이 지워지면 profiles 가 함께 지워지고, 메모는 작성자만 비운 채 남는다.
-- 20261014000001 이 만든 auth.users 외래 키를 바꾼다. 그 파일은 고치지 않는다(append-only).

alter table public.memos drop constraint if exists memos_user_id_fkey;
alter table public.memos
  add constraint memos_user_id_fkey foreign key (user_id) references public.profiles (id) on delete set null;
