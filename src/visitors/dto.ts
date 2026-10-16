import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

export class CreatePassDto {
  @IsUUID() organizationId: string;
  @IsString() @MinLength(2) visitorName: string;
  @IsOptional() @IsString() visitorPhone?: string;
  @IsOptional() @IsString() purpose?: string;
  @IsDateString() validFrom: string;
  @IsDateString() validUntil: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxEntries?: number;
}

export class VerifyPassDto {
  @IsUUID() organizationId: string;
  @IsString() code: string;
}
