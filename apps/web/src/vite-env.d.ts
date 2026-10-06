/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLINICAL_ENV?: 'development' | 'demo';
  readonly VITE_ENABLE_XRAY_ANALYSIS?: string;
  readonly VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
