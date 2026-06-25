import { Resend } from 'resend'
import nodemailer from 'nodemailer'

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text: string
}

export async function sendEmail({ to, subject, html, text }: SendEmailOptions): Promise<void> {
  const provider = process.env.MAIL_PROVIDER ?? 'resend'

  if (provider === 'smtp') {
    const from = process.env.SMTP_FROM ?? process.env.RESEND_FROM ?? 'noreply@frontiere.io'
    console.log(`[mailer] smtp -> to=${to} from=${from} subject="${subject}"`)
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
    console.log(`[mailer] smtp OK messageId=${info.messageId}`)
    return
  }

  // Default: Resend
  const from = process.env.RESEND_FROM ?? 'noreply@frontiere.io'
  console.log(`[mailer] resend -> to=${to} from=${from} subject="${subject}"`)
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send({ from, to, subject, html, text })
  if (error) {
    console.error(`[mailer] resend ERROR: ${JSON.stringify(error)}`)
    throw new Error(`Resend error: ${error.message}`)
  }
  console.log(`[mailer] resend OK id=${data?.id}`)
}
