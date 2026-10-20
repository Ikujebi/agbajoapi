import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ProductStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { Permission } from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateProductDto,
  StockAdjustDto,
  UpdateProductDto,
} from './dto';

@Injectable()
export class ProductsService {
  /** Movement types that may be posted manually through the API. */
  private static readonly MANUAL_TYPES: StockMovementType[] = [
    StockMovementType.SALE,
    StockMovementType.RETURN,
    StockMovementType.RESTOCK,
    StockMovementType.DAMAGE,
    StockMovementType.ADJUSTMENT,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Verify that the organization exists, is a shop,
   * and that the user has the required permission.
   */
  private async assertShopPermission(
    user: AuthUser,
    orgId: string,
    permission: Permission,
  ): Promise<void> {
    const org = await this.orgs.getOrThrow(orgId);

    if (org.type !== 'SHOP') {
      throw new BadRequestException(
        'Products can only be managed by shop organizations.',
      );
    }

    await this.permissions.assert(user, orgId, permission);
  }

  /**
   * Load a product and make sure it belongs to a shop.
   */
  private async getShopProductOrThrow(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { organization: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    if (product.organization.type !== 'SHOP') {
      throw new BadRequestException(
        'Products can only be managed by shop organizations.',
      );
    }

    return product;
  }

  /**
   * Create a product and record its initial stock.
   */
  async create(user: AuthUser, orgId: string, dto: CreateProductDto) {
    await this.assertShopPermission(user, orgId, 'product.create');

    if (!Number.isInteger(dto.quantity) || dto.quantity < 0) {
      throw new BadRequestException(
        'Initial quantity must be a non-negative integer.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          description: dto.description,
          sku: dto.sku,
          price: dto.price,
          costPrice: dto.costPrice,
          quantity: dto.quantity,
          lowStockAt: dto.lowStockAt,
          unit: dto.unit,
          imageUrl: dto.imageUrl,
          status: dto.status ?? ProductStatus.ACTIVE,
          isAvailable: dto.isAvailable ?? true,
        },
      });

      if (product.quantity > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: StockMovementType.RESTOCK,
            delta: product.quantity,
            quantityAfter: product.quantity,
            reason: 'Initial stock',
            createdById: user.id,
          },
        });
      }

      return product;
    });
  }

  /**
   * Update editable product details.
   * Stock changes must go through adjustStock().
   */
  async update(user: AuthUser, id: string, dto: UpdateProductDto) {
    const product = await this.getShopProductOrThrow(id);

    await this.permissions.assert(user, product.organizationId, 'product.edit');

    const data: Prisma.ProductUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.costPrice !== undefined) data.costPrice = dto.costPrice;
    if (dto.lowStockAt !== undefined) data.lowStockAt = dto.lowStockAt;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.isAvailable !== undefined) data.isAvailable = dto.isAvailable;

    return this.prisma.product.update({
      where: { id },
      data,
    });
  }

  /**
   * Adjust inventory without allowing negative stock.
   *
   * Attendants may only record SALE and RETURN movements (sale.record).
   * RESTOCK, DAMAGE and ADJUSTMENT require stock.adjust.
   */
  async adjustStock(user: AuthUser, id: string, dto: StockAdjustDto) {
    if (!Number.isInteger(dto.delta) || dto.delta === 0) {
      throw new BadRequestException(
        'Stock adjustment must be a non-zero integer.',
      );
    }

    const type = dto.type ?? StockMovementType.ADJUSTMENT;

    if (!ProductsService.MANUAL_TYPES.includes(type)) {
      throw new BadRequestException(
        `Movement type ${type} cannot be set manually.`,
      );
    }

    const mustDecrease =
      type === StockMovementType.SALE || type === StockMovementType.DAMAGE;
    const mustIncrease =
      type === StockMovementType.RETURN || type === StockMovementType.RESTOCK;

    if ((mustDecrease && dto.delta > 0) || (mustIncrease && dto.delta < 0)) {
      throw new BadRequestException(
        `${type} requires a ${mustDecrease ? 'negative' : 'positive'} delta.`,
      );
    }

    const product = await this.getShopProductOrThrow(id);

    const permission: Permission =
      type === StockMovementType.SALE || type === StockMovementType.RETURN
        ? 'sale.record'
        : 'stock.adjust';

    await this.permissions.assert(user, product.organizationId, permission);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.product.updateMany({
        where: {
          id,
          quantity: {
            gte: dto.delta < 0 ? Math.abs(dto.delta) : 0,
          },
        },
        data: {
          quantity: {
            increment: dto.delta,
          },
        },
      });

      if (result.count === 0) {
        throw new BadRequestException('Insufficient stock.');
      }

      // costPrice is hidden because attendants can reach this endpoint.
      const updated = await tx.product.findUniqueOrThrow({
        where: { id },
        omit: { costPrice: true },
      });

      await tx.stockMovement.create({
        data: {
          productId: id,
          type,
          delta: dto.delta,
          quantityAfter: updated.quantity,
          reason: dto.reason,
          createdById: user.id,
        },
      });

      return updated;
    });
  }

  /**
   * Public product browsing for authenticated users.
   * costPrice is never exposed here.
   */
  async list(orgId?: string, q?: string, inStock?: string) {
    return this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
        isAvailable: true,
        organization: { isActive: true },

        ...(orgId ? { organizationId: orgId } : {}),

        ...(q?.trim()
          ? {
              name: {
                contains: q.trim(),
                mode: 'insensitive',
              },
            }
          : {}),

        ...(inStock === 'true' ? { quantity: { gt: 0 } } : {}),
      },

      omit: { costPrice: true },

      include: {
        organization: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
      },

      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  /**
   * View stock movement history for a shop product.
   * Switch to 'stock.adjust' if attendants should not see this history.
   */
  async movements(user: AuthUser, id: string) {
    const product = await this.getShopProductOrThrow(id);

    await this.permissions.assert(user, product.organizationId, 'product.view');

    return this.prisma.stockMovement.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}