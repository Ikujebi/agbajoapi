
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  MembershipRole,
  ProductStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import {
  CreateProductDto,
  StockAdjustDto,
  UpdateProductDto,
} from './dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
  ) {}

  /**
   * Verify that the organization exists, is a shop,
   * and that the user has permission to manage its inventory.
   */
  private async assertShopStaff(
    userId: string,
    orgId: string,
  ): Promise<void> {
    const org = await this.orgs.getOrThrow(orgId);

    if (org.type !== 'SHOP') {
      throw new BadRequestException(
        'Products can only be managed by shop organizations.',
      );
    }

    const allowedRoles: MembershipRole[] = [
      MembershipRole.OWNER,
      MembershipRole.ADMIN,
      MembershipRole.MANAGER,
      MembershipRole.STAFF,
    ];

    await this.orgs.assertRole(userId, orgId, allowedRoles);
  }

  /**
   * Create a product and record its initial stock.
   */
  async create(
    userId: string,
    orgId: string,
    dto: CreateProductDto,
  ) {
    await this.assertShopStaff(userId, orgId);

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
            createdById: userId,
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
  async update(
    userId: string,
    id: string,
    dto: UpdateProductDto,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    await this.assertShopStaff(userId, product.organizationId);

    const data: Prisma.ProductUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.costPrice !== undefined) {
      data.costPrice = dto.costPrice;
    }
    if (dto.lowStockAt !== undefined) {
      data.lowStockAt = dto.lowStockAt;
    }
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.isAvailable !== undefined) {
      data.isAvailable = dto.isAvailable;
    }

    return this.prisma.product.update({
      where: { id },
      data,
    });
  }

  /**
   * Adjust inventory without allowing negative stock.
   */
  async adjustStock(
    userId: string,
    id: string,
    dto: StockAdjustDto,
  ) {
    if (!Number.isInteger(dto.delta) || dto.delta === 0) {
      throw new BadRequestException(
        'Stock adjustment must be a non-zero integer.',
      );
    }

    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    await this.assertShopStaff(userId, product.organizationId);

    return this.prisma.$transaction(async (tx) => {
      // The condition and decrement/increment happen in one SQL update.
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
        const current = await tx.product.findUnique({
          where: { id },
          select: { id: true },
        });

        if (!current) {
          throw new NotFoundException('Product not found.');
        }

        throw new BadRequestException('Insufficient stock.');
      }

      const updated = await tx.product.findUniqueOrThrow({
        where: { id },
      });

      await tx.stockMovement.create({
        data: {
          productId: id,
          type: StockMovementType.ADJUSTMENT,
          delta: dto.delta,
          quantityAfter: updated.quantity,
          reason: dto.reason,
          createdById: userId,
        },
      });

      return updated;
    });
  }

  /**
   * Public product browsing for authenticated users.
   */
  async list(
    orgId?: string,
    q?: string,
    inStock?: string,
  ) {
    return this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
        isAvailable: true,

        ...(orgId ? { organizationId: orgId } : {}),

        ...(q?.trim()
          ? {
              name: {
                contains: q.trim(),
                mode: 'insensitive',
              },
            }
          : {}),

        ...(inStock === 'true'
          ? { quantity: { gt: 0 } }
          : {}),
      },

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
   */
  async movements(userId: string, id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    await this.assertShopStaff(userId, product.organizationId);

    return this.prisma.stockMovement.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
