import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SosStatus } from "@prisma/client";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "../common/permissions/permissions.service";
import { rolesWith } from "../common/permissions/permissions";
import { AuthUser } from "../common/decorators/current-user.decorator";
import { TriggerSosDto } from "./dto/sos.dto";

/** A user who already has an open alert this recent gets that alert back. */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

@Injectable()
export class SosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async notifyResponders(
    organizationId: string,
    excludeUserId: string,
    title: string,
    body: string,
    data: Record<string, string | number | null>,
  ) {
    const responders = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: "APPROVED",
        role: { in: rolesWith("ESTATE", "sos.respond") },
        userId: { not: excludeUserId },
      },
      select: { userId: true },
    });

    if (responders.length === 0) return;

    await this.notifications.send(
      responders.map((r) => r.userId),
      { type: "SAFETY", title, body, data },
    );
  }

  async trigger(user: AuthUser, organizationId: string, dto: TriggerSosDto) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, type: true, name: true, isActive: true },
    });

    if (!organization || !organization.isActive) {
      throw new NotFoundException("Organization not found.");
    }

    if (organization.type !== "ESTATE") {
      throw new BadRequestException(
        "SOS alerts are only available in estates.",
      );
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
      select: { status: true },
    });

    if (membership?.status !== "APPROVED") {
      throw new ForbiddenException(
        "Only approved estate members can send SOS.",
      );
    }

    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) {
      throw new BadRequestException(
        "Send both latitude and longitude, or neither.",
      );
    }

    // Idempotent: repeated taps return the alert that is already open.
    const recent = await this.prisma.sosAlert.findFirst({
      where: {
        organizationId,
        userId: user.id,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
    });

    if (recent) return recent;

    const alert = await this.prisma.sosAlert.create({
      data: {
        organizationId,
        userId: user.id,
        message: dto.message?.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });

    const sender = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { fullName: true, phone: true },
    });

    await this.notifyResponders(
      organizationId,
      user.id,
      `SOS: ${sender?.fullName ?? "A resident"} needs help`,
      dto.message?.trim() || `Emergency alert in ${organization.name}.`,
      {
        alertId: alert.id,
        organizationId,
        phone: sender?.phone ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      },
    );

    return alert;
  }

  async list(user: AuthUser, organizationId: string, status?: SosStatus) {
    await this.permissions.assert(user, organizationId, "sos.respond");

    return this.prisma.sosAlert.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  mine(userId: string) {
    return this.prisma.sosAlert.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  private async loadForResponder(user: AuthUser, id: string) {
    const alert = await this.prisma.sosAlert.findUnique({ where: { id } });

    if (!alert) {
      throw new NotFoundException("SOS alert not found.");
    }

    await this.permissions.assert(user, alert.organizationId, "sos.respond");

    return alert;
  }

  async acknowledge(user: AuthUser, id: string) {
    const alert = await this.loadForResponder(user, id);

    // Claim by status so two responders cannot both acknowledge.
    const claimed = await this.prisma.sosAlert.updateMany({
      where: { id, status: "OPEN" },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new ConflictException("This alert has already been handled.");
    }

    await this.notifications.send([alert.userId], {
      type: "SAFETY",
      title: "Help is on the way",
      body: "Your SOS has been acknowledged by estate security.",
      data: { alertId: id },
    });

    return this.prisma.sosAlert.findUniqueOrThrow({ where: { id } });
  }

  async resolve(user: AuthUser, id: string) {
    const alert = await this.loadForResponder(user, id);

    const claimed = await this.prisma.sosAlert.updateMany({
      where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new ConflictException("This alert is already closed.");
    }

    await this.notifications.send([alert.userId], {
      type: "SAFETY",
      title: "SOS resolved",
      body: "Your SOS alert was marked as resolved.",
      data: { alertId: id },
    });

    return this.prisma.sosAlert.findUniqueOrThrow({ where: { id } });
  }

  /** The person who raised the alert can cancel it, for example after a false alarm. */
  async cancel(userId: string, id: string) {
    const alert = await this.prisma.sosAlert.findFirst({
      where: { id, userId },
    });

    if (!alert) {
      throw new NotFoundException("SOS alert not found.");
    }

    const claimed = await this.prisma.sosAlert.updateMany({
      where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new ConflictException("This alert is already closed.");
    }

    await this.notifyResponders(
      alert.organizationId,
      userId,
      "SOS cancelled",
      "The resident cancelled their alert.",
      { alertId: id, organizationId: alert.organizationId },
    );

    return this.prisma.sosAlert.findUniqueOrThrow({ where: { id } });
  }
}
