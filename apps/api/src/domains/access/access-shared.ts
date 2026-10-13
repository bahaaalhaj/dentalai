import { createHash } from 'node:crypto';
import { type AuthIdentity } from '@dentalai/contracts';
export interface AccessContext {
  userId: string;
  sessionId: string;
  membership: AuthIdentity['activeMembership'];
  requestId: string;
}
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
