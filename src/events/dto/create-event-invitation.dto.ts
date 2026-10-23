import { IsDateString, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEventInvitationDto {
  @IsString() @IsNotEmpty() @MaxLength(120) guestName!: string;
  @IsOptional() @IsEmail() @MaxLength(254) guestEmail?: string;
  @IsOptional() @IsString() @MaxLength(30) guestPhone?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validUntil?: string;
}
