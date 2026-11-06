
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,

} from 'class-validator';
import { Transform } from 'class-transformer';
export class SendMailDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  to!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500_000)
  @Matches(/\S/, {
    message: 'HTML content must not be empty or whitespace only.',
  })
  html!: string;
}

export class SendBulkMailDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10_000)
  @ArrayUnique((email: string) =>
    typeof email === 'string' ? email.trim().toLowerCase() : email,
  )
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((email) =>
          typeof email === 'string'
            ? email.trim().toLowerCase()
            : email,
        )
      : value,
  )
  @IsEmail({}, { each: true })
  @MaxLength(254, { each: true })
  recipients!: string[];

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500_000)
  @Matches(/\S/, {
    message: 'HTML content must not be empty or whitespace only.',
  })
  html!: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  batchId?: string;
}
