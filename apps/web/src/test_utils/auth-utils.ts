import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';

export async function performLogin(email: string, password: string) {
  try {
    return { success: true, data: await apiClient.login({ email, password }) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
export async function performRegister(
  email: string,
  password: string,
  fullName: string,
  phone: string,
) {
  try {
    return {
      success: true,
      data: await apiClient.register({ email, password, name: fullName, phone }),
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
