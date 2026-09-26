import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performXrayAnalysis } from '../test_utils/xray-utils';

describe('X-Ray Analysis Tests', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // محاكاة (Mocking) للـ FileReader والـ Image لتعمل داخل بيئة الاختبار الوهمية
    (global as any).FileReader = class {
      onload: any;
      readAsDataURL() {
        setTimeout(() => this.onload({ target: { result: 'data:image/png;base64,fake' } }), 10);
      }
    };

    (global as any).Image = class {
      onload: any;
      width = 500;
      height = 500;
      set src(_: string) {
        setTimeout(() => this.onload(), 10);
      }
    };
  });

  it('should return error if a non-image file is uploaded (e.g. PDF)', async () => {
    // 1. Arrange: إدخال ملف نصي (PDF) بدل صورة
    const fakeFile = new File(['dummy content'], 'report.pdf', { type: 'application/pdf' });

    // 2. Act: استدعاء دالة التحليل
    const result = await performXrayAnalysis(fakeFile);

    // 3. Assert: التأكد من أن النظام رفض الملف فوراً
    expect(result.success).toBe(false);
    expect(result.error).toBe('File is not a valid image. Please upload an image file.');
    
    console.log('Test Output for Non-Image File (PDF):', result);
  });

  

});