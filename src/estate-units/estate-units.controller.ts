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
import { EstateUnitsService } from './estate-units.service';
import {
  AddOccupantDto,
  CreateUnitDto,
  ListUnitsQueryDto,
  PinUnitLocationDto,
  UpdateUnitDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller('estate-units')
export class EstateUnitsController {
  constructor(private readonly units: EstateUnitsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUnitDto) {
    return this.units.create(user, dto);
  }

  // Declared before ':id' routes so "mine" is never read as an id.
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.units.mine(user.id);
  }

  @Get('organization/:organizationId')
  list(
    @CurrentUser() user: AuthUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: ListUnitsQueryDto,
  ) {
    return this.units.listByOrganization(user, organizationId, query);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.units.update(user, id, dto);
  }

  @Patch(':id/location')
  setLocation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PinUnitLocationDto,
  ) {
    return this.units.setLocation(user, id, dto);
  }

  @Delete(':id/location')
  clearLocation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.units.clearLocation(user, id);
  }

  @Post(':id/occupants')
  addOccupant(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddOccupantDto,
  ) {
    return this.units.addOccupant(user, id, dto);
  }

  @Delete(':id/occupants/:occupancyId')
  endOccupancy(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('occupancyId', ParseUUIDPipe) occupancyId: string,
  ) {
    return this.units.endOccupancy(user, id, occupancyId);
  }
}
