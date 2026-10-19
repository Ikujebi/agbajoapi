
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class JoinOrgDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  unit?: string;
}
