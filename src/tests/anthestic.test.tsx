import { describe, it, expect } from 'vitest';
import { performDoseCalculation } from '../test_utils/anthestic-utils';

describe('Anesthetic Calculation Tests', () => {
  
  it('should return error if negative age is entered', () => {
    // إدخال عمر سالب (-5)
    const invalidAge = -5;
    const validWeight = 70;
    const bp = "120/80";

    const result = performDoseCalculation(invalidAge, validWeight, bp, false, 'lido_epi', []);

    // التأكد من أن العملية فشلت
    expect(result.success).toBe(false);
    
    // التأكد من وجود رسالة خطأ، وأنها الرسالة الصحيحة
    expect(result.error).toBeDefined();
    expect(result.error).toBe('Age and Weight must be valid positive numbers.');
    
    console.log('Test Output for Negative Age:', result);
  });

  it('should return error if negative weight is entered', () => {
    // إدخال وزن سالب (-10)
    const validAge = 30;
    const invalidWeight = -10;
    const bp = "120/80";

    const result = performDoseCalculation(validAge, invalidWeight, bp, false, 'lido_epi', []);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    
    console.log('Test Output for Negative Weight:', result);
  });

});