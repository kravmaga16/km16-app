import nodemailer from 'npm:nodemailer@7.0.11';
import { createTrialWelcomeHandler } from './handler.mjs';

Deno.serve(createTrialWelcomeHandler({
  env: (name: string) => Deno.env.get(name),
  fetcher: fetch,
  createMailer: () => nodemailer.createTransport({
    host: 'smtp.mail.ovh.net', port: 465, secure: true,
    auth: { user: 'contact@km16.fr', pass: Deno.env.get('KM16_DOCUMENTS_SMTP_PASSWORD') },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false, tls: { rejectUnauthorized: true },
    disableFileAccess: true, disableUrlAccess: true,
  }),
}));
