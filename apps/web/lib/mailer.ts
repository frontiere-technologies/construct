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
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    })
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.RESEND_FROM ?? 'noreply@frontiere.io',
      to,
      subject,
      html,
      text,
    })
    return
  }

  // Default: Resend
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? 'noreply@frontiere.io',
    to,
    subject,
    html,
    text,
  })
  if (error) throw new Error(`Resend error: ${error.message}`)
}
