// 수파베이스 연결 정보 — 개인용(돈 관련) 프로젝트
// Supabase 대시보드 → Project Settings → API Keys 의 Publishable key
// 공개용 키라 코드에 있어도 괜찮아요. 실제 보호는 로그인 + 권한 정책이 해요.
window.TB_CONFIG = {
  SUPABASE_URL: '__NEW_SUPABASE_URL__',
  SUPABASE_ANON_KEY: '__NEW_SUPABASE_PUBLISHABLE_KEY__'
};
