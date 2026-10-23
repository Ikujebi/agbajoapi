import {
  Body, Controller, Get, Param, Patch, Post, Query, UploadedFiles,
  UseGuards, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import {
  CreateEventDto, CreateEventInvitationDto, UpdateEventDto,
  VerifyEventInvitationDto, InvitationDeliveryDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user, dto);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query('organizationId') organizationId?: string) {
    return this.eventsService.mine(user, organizationId);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.eventsService.getOne(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(user, id, dto);
  }

  @Post(':id/invitations')
  createInvitation(
    @CurrentUser() user: AuthUser,
    @Param('id') eventId: string,
    @Body() dto: CreateEventInvitationDto,
  ) {
    return this.eventsService.createInvitation(user, eventId, dto);
  }

  @Post(':id/invitations/:invitationId/send')
  sendInvitation(
    @CurrentUser() user: AuthUser,
    @Param('id') eventId: string,
    @Param('invitationId') invitationId: string,
    @Body() dto: InvitationDeliveryDto,
  ) {
    return this.eventsService.sendInvitation(user, eventId, invitationId, dto);
  }

  @Get(':id/invitations')
  invitations(@CurrentUser() user: AuthUser, @Param('id') eventId: string) {
    return this.eventsService.invitations(user, eventId);
  }

  @Post(':id/images')
  @UseInterceptors(FilesInterceptor('images', 5, {
    storage: memoryStorage(),
    limits: { files: 5, fileSize: 5 * 1024 * 1024 },
  }))
  uploadImages(
    @CurrentUser() user: AuthUser,
    @Param('id') eventId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Upload at least one image.');
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype)) {
        throw new BadRequestException('Only JPG, PNG, WEBP, and AVIF images are allowed.');
      }
    }
    return this.eventsService.uploadImages(user, eventId, files);
  }

  @Post('invitations/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyInvitation(@CurrentUser() user: AuthUser, @Body() dto: VerifyEventInvitationDto) {
    return this.eventsService.verifyInvitation(user, dto);
  }

  @Post('invitations/check-in')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: VerifyEventInvitationDto) {
    return this.eventsService.checkIn(user, dto);
  }
}
