
import { ReportStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const REPORT_TARGETS = [
  'LISTING',
  'USER',
  'MESSAGE',
  'ORGANIZATION',
  'NOTICE',
  'REVIEW',
] as const;

export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  'SPAM',
  'SCAM',
  'HARASSMENT',
  'INAPPROPRIATE',
  'FAKE',
  'SAFETY',
  'OTHER',
] as const;

export const RESOLVE_ACTIONS = [
  'REMOVE_LISTING',
  'DEACTIVATE_USER',
  'HIDE_REVIEW',
] as const;

export type ResolveAction = (typeof RESOLVE_ACTIONS)[number];

export class CreateReportDto {
  @IsIn([...REPORT_TARGETS])
  targetType!: ReportTarget;

  @IsUUID()
  targetId!: string;

  @IsIn([...REPORT_REASONS])
  reason!: (typeof REPORT_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ReportQueryDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @IsIn([...REPORT_TARGETS])
  targetType?: ReportTarget;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ResolveReportDto {
  @IsIn(['ACTIONED', 'DISMISSED'])
  outcome!: 'ACTIONED' | 'DISMISSED';

  /** Required when the outcome is ACTIONED. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** Optional automatic action, applied before the report is closed. */
  @IsOptional()
  @IsIn([...RESOLVE_ACTIONS])
  action?: ResolveAction;
}
