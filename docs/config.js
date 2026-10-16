// Supabaseの接続先。anonキーは公開してよい鍵（見られる範囲はデータベース側のRLSで守る）
window.APP_CONFIG = {
  supabaseUrl: 'https://fesasskyvogpmifxhxoa.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlc2Fzc2t5dm9ncG1pZnhoeG9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMDgxNDcsImV4cCI6MjEwNzY4NDE0N30.eaZMcw6MmPnz-AAVDz_BKXhleLY1ic5mdcMsh5MgUIA',
  // AIの動かし方
  //   'claude-code' … チャットの指示を「依頼」としてためる。芹澤さんのClaude Codeが処理して下書きを書き込む（サブスクの範囲内）
  //   'api'         … アプリから直接AIを呼ぶ（Edge Function studio-ai。Claude APIキーが必要）
  aiMode: 'claude-code',
};
