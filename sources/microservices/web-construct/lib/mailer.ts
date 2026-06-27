import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('mailer')

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text: string
}

export async function sendEmail({ to, subject, html, text }: SendEmailOptions): Promise<void> {
  const devOverride = process.env.EMAIL_DEV_OVERRIDE
  if (devOverride) {
    log.info({ originalTo: to, overrideTo: devOverride }, 'dev override: redirecting email')
    to = devOverride
  }

  const provider = process.env.MAIL_PROVIDER ?? 'resend'

  if (provider === 'smtp') {
    const from = process.env.SMTP_FROM ?? process.env.RESEND_FROM ?? 'noreply@frontiere.io'
    log.info({ provider: 'smtp', to, from, subject }, 'sending email')
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    })
    const info = await transporter.sendMail({ from, to, subject, html, text })
    log.info({ provider: 'smtp', messageId: info.messageId }, 'email sent')
    return
  }

  // Default: Resend
  const from = process.env.RESEND_FROM ?? 'noreply@frontiere.io'
  log.info({ provider: 'resend', to, from, subject }, 'sending email')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send({ from, to, subject, html, text })
  if (error) {
    log.error({ err: error, provider: 'resend' }, 'email send failed')
    throw new Error(`Resend error: ${error.message}`)
  }
  log.info({ provider: 'resend', id: data?.id }, 'email sent')
}
