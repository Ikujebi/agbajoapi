import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto, StockAdjustDto, UpdateProductDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ProductsController {
  constructor(private products: ProductsService) {}

  @Get('products')
  list(@Query('orgId') orgId?: string, @Query('q') q?: string, @Query('inStock') inStock?: string) {
    return this.products.list(orgId, q, inStock);
  }

  @Post('shops/:orgId/products')
  create(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() dto: CreateProductDto) {
    return this.products.create(u.id, orgId, dto);
  }

  @Patch('products/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(u.id, id, dto);
  }

  @Post('products/:id/stock')
  stock(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StockAdjustDto) {
    return this.products.adjustStock(u.id, id, dto);
  }

  @Get('products/:id/movements')
  movements(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.products.movements(u.id, id);
  }
}
