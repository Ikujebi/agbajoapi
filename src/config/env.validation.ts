import { plainToInstance } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength, ValidateIf, validateSync } from 'class-validator';

class Env {
  @IsOptional() @IsIn(['development', 'production', 'test']) NODE_ENV?: string;

  @IsString() @MinLength(1) DATABASE_URL: string;

  @IsString() @MinLength(32, { message: 'must be at least 32 characters' }) JWT_ACCESS_SECRET: string;
  @IsString() @MinLength(32, { message: 'must be at least 32 characters' }) JWT_REFRESH_SECRET: string;

  /** Pepper for visitor-pass code hashes. Changing it invalidates all existing passes. */
  @IsString() @MinLength(32, { message: 'must be at least 32 characters' }) PASS_CODE_SECRET: string;

  @ValidateIf((o) => o.NODE_ENV === 'production') @IsString() @MinLength(1) RESEND_API_KEY?: string;
  @ValidateIf((o) => o.NODE_ENV === 'production') @IsString() @MinLength(1) RESEND_FROM?: string;

  @IsOptional() @IsString() CORS_ORIGINS?: string; // comma separated, for web admin / socket.io
  @IsOptional() @IsString() PAYSTACK_SECRET_KEY?: string;
}

/** Use: ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }) */
export function validateEnv(config: Record<string, unknown>) {
  const env = plainToInstance(Env, config);
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length) {
    const lines = errors.map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const secrets = [config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET, config.PASS_CODE_SECRET];
  if (new Set(secrets).size !== secrets.length) {
    throw new Error('JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and PASS_CODE_SECRET must all be different');
  }
  return config;
}
