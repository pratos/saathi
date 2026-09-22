import { describe, expect, test } from "vitest";
import { extractOtpCode, isUnexpiredOtp, OTP_SHARE_TTL_MS } from "./otpSharing";

describe("ephemeral OTP sharing", () => {
  test.each([
    ["Your OTP is 481921. Do not share it.", "481921"],
    ["Verification code: A7K29Q", "A7K29Q"],
    ["123 456 is your one-time password", "123456"],
    ["Use login code 9012 to continue", "9012"],
  ])("extracts a bounded code with authentication context", (text, expected) => {
    expect(extractOtpCode(text)).toBe(expected);
  });

  test.each([
    "Your appointment is at 12:30 on 22 September",
    "Call us at 9876543210",
    "Your account ending 1234 was credited",
    "This is your verification code",
  ])("does not treat unrelated or missing values as OTPs", text => {
    expect(extractOtpCode(text)).toBeNull();
  });

  test("accepts only mail received within the five-minute window", () => {
    const now = 2_000_000;
    expect(isUnexpiredOtp(now - OTP_SHARE_TTL_MS + 1, now)).toBe(true);
    expect(isUnexpiredOtp(now - OTP_SHARE_TTL_MS, now)).toBe(false);
    expect(isUnexpiredOtp(now + 60_001, now)).toBe(false);
  });
});
