-- 타오바오 정산용 테이블
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run

create table if not exists public.tb_docs (
  id text primary key,            -- 'meta' 또는 'o_주문번호'
  body jsonb not null,            -- 주문 내용, 구매자 지정, 번역 이름 등
  updated_at timestamptz not null default now()
);

-- 로그인 없이 anon 키로 읽고 쓰기 허용 (링크를 아는 사람만 쓰는 개인 페이지용)
alter table public.tb_docs enable row level security;

drop policy if exists "tb_docs anon all" on public.tb_docs;
create policy "tb_docs anon all" on public.tb_docs
  for all to anon
  using (true) with check (true);

grant select, insert, update, delete on public.tb_docs to anon;
