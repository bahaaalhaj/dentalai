const messages = {
  en: {
    close: 'Close dialog',
    errorTitle: 'Something went wrong',
    errorBody:
      'An unexpected error occurred. Refresh and verify the last operation before retrying.',
    refresh: 'Refresh Application',
  },
  ar: {
    close: 'إغلاق النافذة',
    errorTitle: 'حدث خطأ',
    errorBody: 'حدث خطأ غير متوقع. أعد التحميل وتحقق من العملية الأخيرة قبل المحاولة مجدداً.',
    refresh: 'إعادة تحميل التطبيق',
  },
};
export function uiMessages() {
  return messages[
    typeof document !== 'undefined' && document.documentElement.lang === 'ar' ? 'ar' : 'en'
  ];
}
