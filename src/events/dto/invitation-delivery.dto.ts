import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export enum InvitationDeliveryMethod {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  COPY = 'COPY',
  MESSAGE = 'MESSAGE',
}

export class InvitationDeliveryDto {
  @IsEnum(InvitationDeliveryMethod)
  method!: InvitationDeliveryMethod;

  @IsString()
  @Matches(/^[A-HJ-NP-Z2-9]{8}$/i, { message: 'Invitation code must contain exactly 8 valid characters.' })
  code!: string;

  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}
