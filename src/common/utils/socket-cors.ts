const allowedOrigins = (): string[] =>
  (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

/**
 * Decorators run when a file is imported, before ConfigModule has loaded
 * .env. Reading the variable inside this function (at connection time)
 * avoids an empty allow-list.
 *
 * Native mobile apps send no Origin header and are always allowed.
 */
export const socketCorsOrigin = (
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
): void => {
  callback(null, !origin || allowedOrigins().includes(origin));
};
