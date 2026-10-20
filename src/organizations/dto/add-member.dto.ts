import { MembershipRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddMemberDto {
  @IsString() phone!: string;
  @IsEnum(MembershipRole) role!: MembershipRole;
  @IsOptional() @IsString() @MaxLength(80) title?: string;
}