import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NoticeStatus } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { NoticesService } from './notices.service';
import { CreateNoticeDto, UpdateNoticeDto } from './dto/notice.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  /** GET /api/organizations/:orgId/notices */
  @Get('organizations/:orgId/notices')
  list(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('status') status?: string,
  ) {
    if (status && !Object.values(NoticeStatus).includes(status as NoticeStatus)) {
      throw new BadRequestException('Invalid status filter');
    }

    return this.notices.list(user, orgId, status as NoticeStatus | undefined);
  }

  /** POST /api/organizations/:orgId/notices */
  @Post('organizations/:orgId/notices')
  create(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateNoticeDto,
  ) {
    return this.notices.create(user, orgId, dto);
  }

  /** PATCH /api/notices/:id */
  @Patch('notices/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoticeDto,
  ) {
    return this.notices.update(user, id, dto);
  }

  /** DELETE /api/notices/:id (archives the notice) */
  @Delete('notices/:id')
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notices.archive(user, id);
  }
}
