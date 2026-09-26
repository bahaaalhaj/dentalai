import { describe, it, expect} from 'vitest';
import { prepareTreatmentPieData } from '../test_utils/doctor-util';


describe('Doctor Dashboard Logic', () => {
it('prepares treatment distribution data correctly', () => {
    const mockRecords = [
      { teeth_status: { '11': 'cavity', '12': 'filling' } },
      { teeth_status: { '21': 'cavity' } }
    ];
    
    const pieData = prepareTreatmentPieData(mockRecords);
    
    const cavityEntry = pieData.find(d => d.name === 'Cavity');
    const fillingEntry = pieData.find(d => d.name === 'Filling');
    
    expect(cavityEntry?.value).toBe(2);
    expect(fillingEntry?.value).toBe(1);
    expect(pieData.length==3).toBe(false);
  });
});