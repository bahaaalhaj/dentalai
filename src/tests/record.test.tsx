import { describe, it, expect} from 'vitest';
import { CreateMedicalRecord} from '../test_utils/record-utils';
import { create } from 'domain';

describe('Auth Login Tests', () => {
  it('shouldnt create a new record for unreal paitent ', async () => {
   const fakepaitentid ='000000000'

    const result = await CreateMedicalRecord(fakepaitentid);

    expect(result.success).toBe(false);
    
    expect(result.error).toBeDefined();
    console.log('Test Output :', result);
  });
});


