import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateCategoryDto } from './dto/marketplace.dto';

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-');

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Top-level categories, each with its sub-categories. */
  async tree() {
    const all = await this.prisma.marketplaceCategory.findMany({
      orderBy: { name: 'asc' },
    });

    return all
      .filter((category) => !category.parentId)
      .map((root) => ({
        id: root.id,
        name: root.name,
        slug: root.slug,
        children: all
          .filter((child) => child.parentId === root.id)
          .map((child) => ({ id: child.id, name: child.name, slug: child.slug })),
      }));
  }

  async create(user: AuthUser, dto: CreateCategoryDto) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Only platform admins can manage categories.');
    }

    if (dto.parentId) {
      const parent = await this.prisma.marketplaceCategory.findUnique({
        where: { id: dto.parentId },
        select: { parentId: true },
      });

      if (!parent) {
        throw new NotFoundException('Parent category not found.');
      }

      // Two levels keeps browsing simple.
      if (parent.parentId) {
        throw new BadRequestException(
          'Categories can only be nested one level deep.',
        );
      }
    }

    try {
      return await this.prisma.marketplaceCategory.create({
        data: {
          name: dto.name.trim(),
          slug: slugify(dto.name),
          parentId: dto.parentId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A category with this name already exists.');
      }

      throw error;
    }
  }

  async remove(user: AuthUser, id: string) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Only platform admins can manage categories.');
    }

    // Listings keep existing, they just lose their category.
    await this.prisma.marketplaceCategory.deleteMany({ where: { id } });

    return { ok: true };
  }
}
