import nodemailer from 'nodemailer';

export interface AuthMail {
  to: string;
  subject: string;
  text: string;
}
export type MailSender = (message: AuthMail) => Promise<void>;

export function smtpMailSender(url: string, from: string): MailSender {
  const transport = nodemailer.createTransport({
    url,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    logger: false,
    debug: false,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
  return async (message) => {
    await transport.sendMail({ ...message, from });
  };
}
