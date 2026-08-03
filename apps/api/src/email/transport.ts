import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { env, resolveFromRepoRoot } from '../env';
import { logger } from '../logger';

/**
 * Email delivery.
 *
 * Three transports, chosen by `EMAIL_TRANSPORT`:
 *
 *  - `stream` (default) writes a real `.eml` file to disk and sends nothing.
 *    Development and tests get a complete, inspectable message without an SMTP
 *    account and without any risk of emailing a real person.
 *  - `json` serialises the message to the log only.
 *  - `smtp` performs real delivery.
 *
 * The rest of the application calls `sendMail` and does not know which is in
 * use, so switching to real delivery is a configuration change.
 */

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  delivered: boolean;
  transport: typeof env.EMAIL_TRANSPORT;
  messageId: string | null;
  /** Where a `stream`-transport message was written. */
  outputPath: string | null;
  error?: string;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  switch (env.EMAIL_TRANSPORT) {
    case 'smtp':
      transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
        // Never let a hung SMTP server stall the monitoring job.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      break;

    case 'json':
      transporter = nodemailer.createTransport({ jsonTransport: true });
      break;

    case 'stream':
    default:
      // buffer:true gives us the full RFC-822 message to write to disk.
      transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
      break;
  }

  return transporter;
}

/** Filesystem-safe, sortable filename for a captured message. */
function emlFilename(to: string, subject: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = `${to}-${subject}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${stamp}-${slug || 'message'}.eml`;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const transport = env.EMAIL_TRANSPORT;

  try {
    const info = await getTransporter().sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    let outputPath: string | null = null;

    if (transport === 'stream') {
      // `message` is a Buffer because the transport was created with buffer:true.
      const raw = (info as unknown as { message?: Buffer }).message;
      const directory = resolveFromRepoRoot(env.EMAIL_OUTPUT_DIR);
      await mkdir(directory, { recursive: true });
      outputPath = path.join(directory, emlFilename(input.to, input.subject));
      await writeFile(outputPath, raw ?? Buffer.from(input.text, 'utf8'));

      logger.info({ to: input.to, subject: input.subject, outputPath }, 'Alert email written to disk');
    } else if (transport === 'json') {
      logger.info(
        { to: input.to, subject: input.subject, message: (info as { message?: string }).message },
        'Alert email serialised',
      );
    } else {
      logger.info({ to: input.to, subject: input.subject, messageId: info.messageId }, 'Alert email sent');
    }

    return {
      delivered: true,
      transport,
      messageId: info.messageId ?? null,
      outputPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Delivery failure must not abort the monitoring run: it is recorded on the
    // notification row and the next item is processed.
    logger.error({ to: input.to, subject: input.subject, err: error }, 'Failed to send alert email');
    return { delivered: false, transport, messageId: null, outputPath: null, error: message };
  }
}

/** Where `stream` transport messages are written, for display in API responses. */
export function emailOutputDirectory(): string {
  return resolveFromRepoRoot(env.EMAIL_OUTPUT_DIR);
}

/** Test hook: forget the memoised transporter. */
export function resetTransporter(): void {
  transporter = undefined;
}
