type EmailPurpose = "verification" | "password-reset";

export type EmailDeliveryResult = {
  delivery: "provider" | "development";
  developmentToken?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function isEmailDeliveryConfigured() {
  return (process.env.EMAIL_PROVIDER || "").toLowerCase() === "sendgrid"
    && Boolean(process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM);
}

export async function sendAccountEmail(input: {
  email: string;
  name: string;
  token: string;
  purpose: EmailPurpose;
}): Promise<EmailDeliveryResult> {
  if (!isEmailDeliveryConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email delivery is not configured for production.");
    }
    return { delivery: "development", developmentToken: input.token };
  }

  const isVerification = input.purpose === "verification";
  const subject = isVerification ? "Verify your SmartSize account" : "Reset your SmartSize password";
  const action = isVerification ? "verify-email" : "reset-password";
  const origin = process.env.APP_ORIGIN || "http://localhost:3000";
  const link = new URL(`/${action}`, origin);
  link.searchParams.set("token", input.token);
  const safeName = escapeHtml(input.name);
  const safeLink = escapeHtml(link.toString());
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.email }], subject }],
      from: { email: process.env.EMAIL_FROM },
      content: [{
        type: "text/html",
        value: `<p>Hello ${safeName},</p><p><a href="${safeLink}">${isVerification ? "Verify your email address" : "Reset your password"}</a></p><p>If you did not request this, you can ignore this message.</p>`,
      }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Email provider rejected the ${input.purpose} message (${response.status}).`);
  }
  return { delivery: "provider" };
}
