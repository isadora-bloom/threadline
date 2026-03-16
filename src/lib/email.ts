import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM ?? 'Threadline <noreply@threadline.app>'

export async function sendInvitationEmail({
  to,
  caseName,
  role,
  invitedBy,
  acceptUrl,
}: {
  to: string
  caseName: string
  role: string
  invitedBy: string
  acceptUrl: string
}) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: `You've been invited to ${caseName} on Threadline`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1e293b;">
        <div style="margin-bottom: 24px;">
          <div style="display: inline-flex; background: #4f46e5; width: 40px; height: 40px; border-radius: 8px; align-items: center; justify-content: center; margin-bottom: 12px;">
            <span style="color: white; font-weight: bold; font-size: 16px;">TL</span>
          </div>
          <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 4px;">Threadline</h1>
          <p style="font-size: 13px; color: #64748b; margin: 0;">Case intelligence for the people who refuse to give up.</p>
        </div>

        <p style="font-size: 15px; margin: 0 0 12px;">
          <strong>${invitedBy}</strong> has invited you to collaborate on <strong>${caseName}</strong> as a <strong>${role}</strong>.
        </p>

        <p style="font-size: 14px; color: #475569; margin: 0 0 24px;">
          Threadline is a structured case intelligence workspace for investigators, nonprofits, and journalists.
          All information on the platform is treated as unverified unless explicitly confirmed.
          By accepting this invitation you agree to the platform's terms of use.
        </p>

        <a href="${acceptUrl}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px;">
          Accept invitation
        </a>

        <p style="font-size: 12px; color: #94a3b8; margin: 24px 0 0;">
          This invitation expires in 7 days. If you weren't expecting this, you can safely ignore it.
          Do not share this link.
        </p>
      </div>
    `,
  })
}

export async function sendCaseMagicLink({
  to,
  magicLink,
}: {
  to: string
  magicLink: string
}) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: 'Your Threadline sign-in link',
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1e293b;">
        <h1 style="font-size: 18px; font-weight: 700; margin: 0 0 16px;">Sign in to Threadline</h1>
        <p style="font-size: 14px; color: #475569; margin: 0 0 24px;">
          Click the link below to sign in. This link expires in 1 hour and can only be used once.
        </p>
        <a href="${magicLink}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px;">
          Sign in to Threadline
        </a>
        <p style="font-size: 12px; color: #94a3b8; margin: 24px 0 0;">
          If you didn't request this, ignore it. Do not share this link.
        </p>
      </div>
    `,
  })
}
