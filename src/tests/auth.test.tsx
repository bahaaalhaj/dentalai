import { describe, it, expect} from 'vitest';
import { performLogin , performRegister } from '../test_utils/auth-utils';
import { supabase } from '../lib/supabase';


describe('Auth Login Tests', () => {
  it('should return error for non-existent user login', async () => {
    const fakeEmail = 'balhaj452@gmail.com';
    const fakePassword = '12345678';

    const result = await performLogin(fakeEmail, fakePassword);

    expect(result.success).toBe(false);
    
    expect(result.error).toBeDefined();
    console.log('Test Output for Login (Fake Params):', result);
  });

});

describe('Auth Register Tests', () => {
  it('should return error for non-existent user login', async () => {
    const wrongEmail = 'ghostexample.com';
    const Password = '12345678';
    const fullName =" Ahmed ALamed"
    const phone = '1234567890';

    const result = await performRegister(wrongEmail, Password, fullName, phone);

    expect(result.success).toBe(false);
    
    expect(result.error).toBeDefined();
    console.log('Test Output for Register (wrong email):', result);
  });

});