import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreatePassDto, VerifyPassDto } from './dto';

// No 0/O/1/I so codes are easy to read out at the gate
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

@Injectable()
export class VisitorsService {
  constructor(private prisma: PrismaService, private orgs: OrganizationsService) {}

  async create(hostId: string, dto: CreatePassDto) {
    const org = await this.orgs.getOrThrow(dto.organizationId);
    if (org.type !== 'ESTATE') throw new BadRequestException('Visitor passes are only for estates');
    await this.orgs.assertRole(hostId, org.id, ['RESIDENT', 'ORG_ADMIN']);

    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    if (validUntil <= validFrom) throw new BadRequestException('validUntil must be after validFrom');

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.visitorPass.create({
          data: {
            code: makeCode(), organizationId: org.id, hostId,
            visitorName: dto.visitorName, visitorPhone: dto.visitorPhone, purpose: dto.purpose,
            validFrom, validUntil, maxEntries: dto.maxEntries ?? 1,
          },
        });
      } catch (e: any) {
        if (e.code !== 'P2002') throw e; // retry only on code collision
      }
    }
    throw new BadRequestException('Could not generate a code, try again');
  }

  mine(hostId: string) {
    return this.prisma.visitorPass.findMany({
      where: { hostId }, orderBy: { createdAt: 'desc' }, take: 100,
    });
  }

  async revoke(hostId: string, id: string) {
    const pass = await this.prisma.visitorPass.findFirst({ where: { id, hostId } });
    if (!pass) throw new NotFoundException('Pass not found');
    return this.prisma.visitorPass.update({ where: { id }, data: { status: 'REVOKED' } });
  }

  /** Security scans/types a code at the gate. */
  async verify(securityId: string, dto: VerifyPassDto) {
    await this.orgs.assertRole(securityId, dto.organizationId, ['SECURITY', 'ORG_ADMIN']);
    const pass = await this.prisma.visitorPass.findFirst({
      where: { code: dto.code.trim().toUpperCase(), organizationId: dto.organizationId },
      include: { host: { select: { id: true, fullName: true, phone: true } } },
    });
    if (!pass) throw new NotFoundException('Invalid code');
    if (pass.status === 'REVOKED') throw new BadRequestException('This pass was revoked');
    if (pass.status === 'COMPLETED' || pass.entriesUsed >= pass.maxEntries) throw new BadRequestException('Pass already used');

    const now = new Date();
    if (now < pass.validFrom) throw new BadRequestException('Pass is not valid yet');
    if (now > pass.validUntil) {
      await this.prisma.visitorPass.update({ where: { id: pass.id }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('Pass has expired');
    }

    const used = pass.entriesUsed + 1;
    const [updated] = await this.prisma.$transaction([
      this.prisma.visitorPass.update({
        where: { id: pass.id },
        data: { entriesUsed: used, status: used >= pass.maxEntries ? 'COMPLETED' : 'ACTIVE' },
      }),
      this.prisma.gateLog.create({ data: { passId: pass.id, securityId, action: 'ENTRY' } }),
      this.prisma.notification.create({
        data: { userId: pass.hostId, title: 'Visitor arrived', body: `${pass.visitorName} has been let in at the gate.` },
      }),
    ]);
    return { valid: true, visitorName: pass.visitorName, purpose: pass.purpose, host: pass.host, pass: updated };
  }

  /** Log a visitor leaving. */
  async exit(securityId: string, dto: VerifyPassDto) {
    await this.orgs.assertRole(securityId, dto.organizationId, ['SECURITY', 'ORG_ADMIN']);
    const pass = await this.prisma.visitorPass.findFirst({
      where: { code: dto.code.trim().toUpperCase(), organizationId: dto.organizationId },
    });
    if (!pass) throw new NotFoundException('Invalid code');
    await this.prisma.gateLog.create({ data: { passId: pass.id, securityId, action: 'EXIT' } });
    return { ok: true, visitorName: pass.visitorName };
  }

  async gateLog(userId: string, organizationId: string) {
    await this.orgs.assertRole(userId, organizationId, ['SECURITY', 'ORG_ADMIN']);
    return this.prisma.gateLog.findMany({
      where: { pass: { organizationId } },
      include: { pass: { select: { visitorName: true, code: true, host: { select: { fullName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
