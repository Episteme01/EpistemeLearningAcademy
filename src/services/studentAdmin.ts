import { gatewayCall } from './files';
import { audit } from './audit';

/**
 * Sets a new password on a child's username account. Done by the gateway (it holds the Firebase admin key),
 * which only accepts it from admin / principal / admissions and only for student username accounts.
 */
export async function resetStudentPassword(uid: string, password: string): Promise<void> {
  await gatewayCall({ action: 'reset-student-password', uid, password });
  void audit('account.reset_password', `users/${uid}`, 'student password reset');
}
