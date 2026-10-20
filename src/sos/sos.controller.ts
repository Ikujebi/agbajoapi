
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { TriggerSosDto } from './dto/trigger-sos.dto';
import { SosService } from './sos.service';

@Controller('organizations/:organizationId/sos')
export class SosController {
  constructor(
    private readonly sosService: SosService,
  ) {}

  @Post('trigger')
  @HttpCode(HttpStatus.CREATED)
  trigger(
    @CurrentUser() user: AuthUser,
    @Param('organizationId', ParseUUIDPipe)
    organizationId: string,
    @Body() dto: TriggerSosDto,
  ) {
    return this.sosService.trigger(
      user,
      organizationId,
      dto,
    );
  }
}
