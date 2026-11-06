
// src/mail/templates/auth/index.ts

export { emailVerificationTemplate } from './email-verification.template';
export type { EmailVerificationOptions } from './email-verification.template';

export { otpTemplate } from './otp';
export type {
  OtpEmailOptions,
  OtpPurpose,
} from './otp';

export { passwordResetTemplate } from './password-reset.template';
export type { PasswordResetOptions } from './password-reset.template';

export { passwordChangedTemplate } from './password-changed.template';
export type { PasswordChangedOptions } from './password-changed.template';

export { loginAlertTemplate } from './login-alert.template';
export type { LoginAlertOptions } from './login-alert.template';
