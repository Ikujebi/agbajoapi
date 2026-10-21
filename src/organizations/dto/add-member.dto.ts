import { MembershipRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddMemberDto {
  /** Phone number the user registered with. */
  @IsString()
  phone!: string;

  /** Must be a role that exists for the organization's type. */
  @IsEnum(MembershipRole)
  role!: MembershipRole;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;
}