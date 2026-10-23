import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyEventInvitationDto {
  @IsString() @IsNotEmpty() eventId!: string;
  @IsString() @Matches(/^[A-HJ-NP-Z2-9]{8}$/i, { message: 'Invitation code must contain exactly 8 valid characters.' })
  code!: string;
}
