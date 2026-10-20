
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { VisitorsService } from './visitors.service';
import { CreatePassDto, VerifyPassDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('visitors')
export class VisitorsController {
  constructor(private readonly visitorsService: VisitorsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePassDto,
  ) {
    return this.visitorsService.create(user, dto);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.visitorsService.mine(user.id);
  }

  @Patch(':id/revoke')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.visitorsService.revoke(user.id, id);
  }

  @Post('verify')
  verify(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyPassDto,
  ) {
    return this.visitorsService.verify(user, dto);
  }

  @Post('exit')
  exit(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyPassDto,
  ) {
   return this.visitorsService.exit(user, dto);
  }

  @Get('log/:organizationId')
  log(
    @CurrentUser() user: AuthUser,
    @Param('organizationId') organizationId: string,
  ) {
    return this.visitorsService.gateLog(user, organizationId);
  }
}
