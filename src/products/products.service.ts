import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreateProductDto, StockAdjustDto, UpdateProductDto } from './dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private orgs: OrganizationsService) {}

  private async assertShopStaff(userId: string, orgId: string) {
    const org = await this.orgs.getOrThrow(orgId);
    if (org.type !== 'SHOP') throw new BadRequestException('Not a shop');
    await this.orgs.assertRole(userId, orgId, ['ORG_ADMIN', 'STAFF']);
  }

  async create(userId: string, orgId: string, dto: CreateProductDto) {
    await this.assertShopStaff(userId, orgId);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { ...dto, organizationId: orgId } });
      if (dto.quantity > 0) {
        await tx.stockMovement.create({
          data: { productId: product.id, delta: dto.quantity, quantityAfter: dto.quantity, reason: 'Initial stock', createdById: userId },
        });
      }
      return product;
    });
  }

  async update(userId: string, id: string, dto: UpdateProductDto) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    await this.assertShopStaff(userId, p.organizationId);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async adjustStock(userId: string, id: string, dto: StockAdjustDto) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    await this.assertShopStaff(userId, p.organizationId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: { quantity: { increment: dto.delta } } });
      if (updated.quantity < 0) throw new BadRequestException('Insufficient stock'); // rolls back
      await tx.stockMovement.create({
        data: { productId: id, delta: dto.delta, quantityAfter: updated.quantity, reason: dto.reason, createdById: userId },
      });
      return updated;
    });
  }

  /** Public browse for any logged-in user. */
  list(orgId?: string, q?: string, inStock?: string) {
    return this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(orgId && { organizationId: orgId }),
        ...(q && { name: { contains: q, mode: 'insensitive' } }),
        ...(inStock === 'true' && { quantity: { gt: 0 } }),
      },
      include: { organization: { select: { id: true, name: true, city: true } } },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  async movements(userId: string, id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    await this.assertShopStaff(userId, p.organizationId);
    return this.prisma.stockMovement.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
