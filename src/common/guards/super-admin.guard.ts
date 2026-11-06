import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/** Use after JwtAuthGuard on platform-admin routes. */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { isSuperAdmin?: boolean } }>();

    if (!request.user?.isSuperAdmin) {
      throw new ForbiddenException('Platform admins only.');
    }

    return true;
  }
}
