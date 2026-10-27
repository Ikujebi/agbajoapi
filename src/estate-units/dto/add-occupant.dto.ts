import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class AddOccupantDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
