import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(2) fullName: string;
  @IsOptional() @IsEmail() email?: string;
  @IsString() @Matches(/^\+?[0-9]{10,15}$/, { message: 'Invalid phone number' }) phone: string;
  @IsString() @MinLength(8) password: string;
}

export class LoginDto {
  @IsString() identifier: string; // email or phone
  @IsString() password: string;
}

export class RefreshDto {
  @IsString() refreshToken: string;
}
