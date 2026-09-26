export const ANESTHETICS = [
    { id: 'lido_epi', name: 'Lidocaine 2% w/ Epi 1:100k', mgPerCartridge: 36, maxDoseMgKg: 7 },
    { id: 'arti_epi', name: 'Articaine 4% w/ Epi 1:100k', mgPerCartridge: 72, maxDoseMgKg: 7 },
    { id: 'mepi_plain', name: 'Mepivacaine 3% Plain', mgPerCartridge: 54, maxDoseMgKg: 6.6 },
    { id: 'prilo_plain', name: 'Prilocaine 4% Plain', mgPerCartridge: 72, maxDoseMgKg: 8 }
  ];
  
  export function performDoseCalculation(
    age: number,
    weight: number,
    bp: string,
    isSmoker: boolean,
    selectedAnestheticId: string,
    diseases: string[]
  ) {
    try {
      // 1. فحص القيم السالبة أو الصفرية (هذا هو الشرط الذي أضفناه)
      if (age <= 0 || weight <= 0) {
        return { success: false, error: 'Age and Weight must be valid positive numbers.' };
      }
  
      const anesthetic = ANESTHETICS.find(an => an.id === selectedAnestheticId);
      if (!anesthetic) {
        return { success: false, error: 'Invalid anesthetic selected.' };
      }
  
      let warnings: string[] = [];
      let status: 'safe' | 'warning' | 'danger' = 'safe';
  
      // 2. العمليات الحسابية (مطابقة لكودك الأصلي تماماً)
      let maxDose = weight * anesthetic.maxDoseMgKg;
      
      if (age > 65) {
        maxDose *= 0.8;
        warnings.push("Geriatric Status: Dose reduced by 20%");
        status = 'warning';
      }
      
      if (diseases.includes('heart_disease')) {
        maxDose *= 0.7;
        warnings.push("Cardiac Condition: High restriction on vasopressors");
        status = 'danger';
      }
  
      // --- هذه الشروط التي سقطت سهواً في المرة السابقة وتمت إعادتها الآن ---
      if (diseases.includes('liver')) {
        maxDose *= 0.6;
        warnings.push("Hepatotoxicity Risk: Metabolism significantly slowed");
      }
  
      if (isSmoker) {
        maxDose *= 1.1;
        warnings.push("Smoker: Metabolic demand increased (+10% dose)");
        warnings.push("Smoker: Risk of delayed wound healing");
      }
  
      const systolic = parseInt(bp.split('/')[0]);
      if (systolic > 160) {
        status = 'danger';
        warnings.push("Critical Hypertension: Avoid epinephrine");
      } else if (systolic > 140) {
        status = 'warning';
        warnings.push("Hypertension: Moderate epi restrictionRecommended");
      }
      // ----------------------------------------------------------------
  
      const recommendedDose = maxDose * 0.7;
      const cartridges = Math.floor(recommendedDose / anesthetic.mgPerCartridge);
  
      // 3. إرجاع النتيجة بنجاح
      return { 
        success: true, 
        data: {
          status: status === 'safe' ? 'safe' : 'danger', // مطابقة للوجيك تبعك
          recommendedMg: Math.round(recommendedDose),
          maxMg: Math.round(maxDose),
          cartridges,
          warnings
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'An unknown error occurred during calculation' };
    }
  }