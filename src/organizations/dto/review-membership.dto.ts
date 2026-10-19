
import { IsEnum, IsOptional } from 'class-validator';
import { MembershipRole, MembershipStatus } from '@prisma/client';

export class ReviewMembershipDto {
  @IsEnum(MembershipStatus)
  status!: MembershipStatus;

  @IsOptional()
  @IsEnum(MembershipRole)
  role?: MembershipRole;
}
