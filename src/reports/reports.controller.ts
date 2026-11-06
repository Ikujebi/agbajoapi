import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import {
  CreateReportDto,
  ReportQueryDto,
  ResolveReportDto,
} from './dto/report.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // ---------- any member ----------

  /** POST /api/reports  { targetType, targetId, reason, details? } */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reports')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }

  /** GET /api/reports/mine: status of the reports you filed. */
  @Get('reports/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.reports.mine(user);
  }

  // ---------- platform admins ----------

  /** GET /api/admin/reports?status=OPEN&targetType=LISTING&cursor= */
  @UseGuards(SuperAdminGuard)
  @Get('admin/reports')
  list(@Query() query: ReportQueryDto) {
    return this.reports.list(query);
  }

  /** GET /api/admin/reports/:id: the report plus a preview of what was reported. */
  @UseGuards(SuperAdminGuard)
  @Get('admin/reports/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(id);
  }

  @UseGuards(SuperAdminGuard)
  @Post('admin/reports/:id/claim')
  claim(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reports.claim(admin, id);
  }

  /** POST /api/admin/reports/:id/resolve  { outcome, note?, action? } */
  @UseGuards(SuperAdminGuard)
  @Post('admin/reports/:id/resolve')
  resolve(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(admin, id, dto);
  }
}