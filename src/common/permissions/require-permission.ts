import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from './permissions';
import { PermissionsService } from './permissions.service';

const KEY = 'required_permission';
export const RequirePermission = (p: Permission) => SetMetadata(KEY, p);

@Injectable()
export class OrgPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<Permission>(KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const req = ctx.switchToHttp().getRequest();
    const orgId = req.params.orgId ?? req.params.organizationId;
    if (!orgId) throw new BadRequestException('Organization id missing in route');

    await this.permissions.assert(req.user, orgId, required);
    return true;
  }
}