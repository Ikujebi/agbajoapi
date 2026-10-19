
import {
  Body,
  Controller,
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

import { ProductsService } from './products.service';
import {
  CreateProductDto,
  StockAdjustDto,
  UpdateProductDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
  ) {}

  /**
   * List publicly available products.
   * Optional filters: orgId, q, inStock.
   *
   * GET /api/products
   * GET /api/products?orgId=<uuid>
   * GET /api/products?q=rice
   * GET /api/products?inStock=true
   */
  @Get('products')
  list(
    @Query('orgId') orgId?: string,
    @Query('q') q?: string,
    @Query('inStock') inStock?: string,
  ) {
    return this.productsService.list(orgId, q, inStock);
  }

  /**
   * Create a product for a shop organization.
   *
   * POST /api/shops/:orgId/products
   */
  @Post('shops/:orgId/products')
  create(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(user.id, orgId, dto);
  }

  /**
   * Update product details without directly changing stock.
   *
   * PATCH /api/products/:id
   */
  @Patch('products/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(user.id, id, dto);
  }

  /**
   * Increase or decrease product stock.
   *
   * POST /api/products/:id/stock
   */
  @Post('products/:id/stock')
  adjustStock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockAdjustDto,
  ) {
    return this.productsService.adjustStock(user.id, id, dto);
  }

  /**
   * Retrieve stock movement history for a product.
   *
   * GET /api/products/:id/movements
   */
  @Get('products/:id/movements')
  movements(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.movements(user.id, id);
  }
}
