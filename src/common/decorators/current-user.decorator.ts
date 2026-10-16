import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthUser = { id: string; isSuperAdmin: boolean };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
