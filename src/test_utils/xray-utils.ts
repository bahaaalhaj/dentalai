import { ClinicalProcessor, XrayAnalysisResult } from '../lib/clinical-cv'; // تأكد من المسار

export async function performXrayAnalysis(file: File) {
  try {
    // 1. فحص مبدئي: التأكد من أن الملف هو صورة فعلاً وليس ملف PDF أو نصي
    if (!file.type.startsWith('image/')) {
      return { success: false, error: 'File is not a valid image. Please upload an image file.' };
    }

    // 2. إرسال الصورة للتحليل (هنا سيتم فحص الكثافة الذي أضفناه)
    const data: XrayAnalysisResult = await ClinicalProcessor.analyze(file);
    
    // 3. في حال النجاح
    return { success: true, data };
    
  } catch (err: any) {
    // 4. التقاط خطأ الكثافة (Density) أو أي خطأ آخر قمنا بعمله عبر reject
    return { success: false, error: err.message || 'An unknown error occurred during analysis' };
  }
}