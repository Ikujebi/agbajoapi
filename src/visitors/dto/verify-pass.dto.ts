
import {
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';

export class VerifyPassDto {
  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @IsString()
  @Matches(/^[A-HJ-NP-Z2-9]{6}$/i, {
    message: 'Pass code must contain exactly 6 valid characters.',
  })
  code!: string;
}
