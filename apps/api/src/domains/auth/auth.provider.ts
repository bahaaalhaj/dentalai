import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { schema, type DentalDatabase } from '@dentalai/database';
import { randomUUID } from 'node:crypto';
import type { MailSender } from './mail.js';

export interface AuthOptions {
  secret: string;
  origin: string;
  sendMail: MailSender;
}

export function createAuthProvider(database: DentalDatabase, options: AuthOptions) {
  return betterAuth({
    appName: 'DentalAI',
    baseURL: options.origin,
    basePath: '/api/v1/auth',
    secret: options.secret,
    trustedOrigins: [options.origin],
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
        rateLimit: schema.authRateLimits,
      },
      transaction: true,
    }),
    user: {
      fields: { name: 'displayName' },
      additionalFields: { phone: { type: 'string', required: false, input: true } },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
      additionalFields: {
        clinicId: { type: 'string', required: false, input: false },
        activeMembershipId: { type: 'string', required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        await options.sendMail({
          to: user.email,
          subject: 'Reset your DentalAI password',
          text: `Reset your password: ${options.origin}/reset-password#token=${encodeURIComponent(token)}`,
        });
      },
      onPasswordReset: async ({ user }) => {
        await database
          .insert(schema.securityEvents)
          .values({ userId: user.id, action: 'auth.password_reset', success: true });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await options.sendMail({
          to: user.email,
          subject: 'Verify your DentalAI email',
          text: `Verify your email: ${url}`,
        });
      },
      afterEmailVerification: async (user) => {
        await database
          .insert(schema.securityEvents)
          .values({ userId: user.id, action: 'auth.email_verified', success: true });
      },
    },
    verification: { storeIdentifier: 'hashed' },
    advanced: {
      ipAddress: { ipAddressHeaders: ['x-dentalai-client-ip'] },
      useSecureCookies: true,
      cookiePrefix: 'dentalai',
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      database: { generateId: () => randomUUID() },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await database
              .insert(schema.securityEvents)
              .values({ userId: session.userId, action: 'auth.session_created', success: true });
          },
        },
        delete: {
          after: async (session) => {
            await database
              .insert(schema.securityEvents)
              .values({ userId: session.userId, action: 'auth.session_revoked', success: true });
          },
        },
      },
      user: {
        create: {
          after: async (user) => {
            await database
              .insert(schema.securityEvents)
              .values({ userId: user.id, action: 'auth.patient_registered', success: true });
          },
        },
      },
    },
    logger: { disabled: true },
  });
}

export type AuthProvider = ReturnType<typeof createAuthProvider>;
