import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  /** Phone number or email the account was registered with. */
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  identifier!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  identifier!: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  // bcrypt only uses the first 72 bytes, so longer passwords add nothing.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(72)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
