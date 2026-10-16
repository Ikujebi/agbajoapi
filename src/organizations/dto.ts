import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MembershipRole, MembershipStatus, OrgType } from '@prisma/client';

export class CreateOrgDto {
  @IsEnum(OrgType) type: OrgType;
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
}

export class JoinOrgDto {
  @IsOptional() @IsString() @MaxLength(50) unit?: string;
}

export class ReviewMembershipDto {
  @IsEnum(MembershipStatus) status: MembershipStatus;
  @IsOptional() @IsEnum(MembershipRole) role?: MembershipRole;
}

export class BroadcastEmailDto {
  @IsString() @MinLength(2) subject: string;
  @IsString() @MinLength(2) body: string;
}
