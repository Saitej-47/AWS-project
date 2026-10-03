import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmailDeliveryConfigured, sendAccountEmail } from "./email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("account email delivery", () => {
  it("returns a development-only token when email is not configured outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_PROVIDER", "disabled");

    await expect(sendAccountEmail({
      email: "person@example.com",
      name: "Example User",
      token: "one-time-token",
      purpose: "password-reset",
    })).resolves.toEqual({ delivery: "development", developmentToken: "one-time-token" });
  });

  it("refuses to expose a development token in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "disabled");

    await expect(sendAccountEmail({
      email: "person@example.com",
      name: "Example User",
      token: "one-time-token",
      purpose: "verification",
    })).rejects.toThrow("Email delivery is not configured for production.");
  });

  it("sends through SendGrid when configured and reports provider failures", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "sendgrid");
    vi.stubEnv("SENDGRID_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(isEmailDeliveryConfigured()).toBe(true);
    await expect(sendAccountEmail({
      email: "person@example.com",
      name: "Example User",
      token: "one-time-token",
      purpose: "verification",
    })).resolves.toEqual({ delivery: "provider" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.sendgrid.com/v3/mail/send");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(sendAccountEmail({
      email: "person@example.com",
      name: "Example User",
      token: "one-time-token",
      purpose: "password-reset",
    })).rejects.toThrow("Email provider rejected the password-reset message (500).");
  });
});
