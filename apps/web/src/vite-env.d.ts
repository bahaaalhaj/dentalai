/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLINICAL_ENV?: 'development' | 'demo';
  readonly VITE_ENABLE_XRAY_ANALYSIS?: string;
  readonly VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
