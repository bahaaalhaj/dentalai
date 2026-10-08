import nodemailer from 'nodemailer';

export interface AuthMail {
  to: string;
  subject: string;
  text: string;
}
export type MailSender = (message: AuthMail) => Promise<void>;

export function smtpMailSender(url: string, from: string): MailSender {
  const transport = nodemailer.createTransport(url);
  return async (message) => {
    await transport.sendMail({ ...message, from });
  };
}
