import {
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

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { NeighborhoodsService } from './neighborhoods.service';
import {
  CreateNeighborhoodDto,
  JoinNeighborhoodDto,
  NeighborhoodQueryDto,
} from './dto/neighborhood.dto';

@UseGuards(JwtAuthGuard)
@Controller('neighborhoods')
export class NeighborhoodsController {
  constructor(private readonly neighborhoods: NeighborhoodsService) {}

  /** GET /api/neighborhoods?q=&city=&state= */
  @Get()
  search(@Query() query: NeighborhoodQueryDto) {
    return this.neighborhoods.search(query);
  }

  /** GET /api/neighborhoods/mine (declared before :id routes) */
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.neighborhoods.mine(user.id);
  }

  /** POST /api/neighborhoods (platform super admin only) */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNeighborhoodDto) {
    return this.neighborhoods.create(user, dto);
  }

  @Post(':id/join')
  join(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JoinNeighborhoodDto,
  ) {
    return this.neighborhoods.join(user.id, id, dto.makePrimary);
  }

  @Patch(':id/primary')
  setPrimary(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.neighborhoods.setPrimary(user.id, id);
  }

  @Delete(':id/leave')
  leave(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.neighborhoods.leave(user.id, id);
  }
}
