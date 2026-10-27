import { registerDecorator, ValidationOptions } from 'class-validator';

export const MAX_ROUTE_POINTS = 500;

/** GeoJSON LineString: coordinates are [longitude, latitude] pairs. */
export type RouteLineString = {
  type: 'LineString';
  coordinates: [number, number][];
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function isRouteLineString(value: unknown): value is RouteLineString {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  // Strict shape: reject extra keys so arbitrary JSON can't be stored.
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('coordinates')) {
    return false;
  }

  const { type, coordinates } = value as Record<string, unknown>;

  if (type !== 'LineString' || !Array.isArray(coordinates)) {
    return false;
  }

  if (coordinates.length < 2 || coordinates.length > MAX_ROUTE_POINTS) {
    return false;
  }

  return coordinates.every((point) => {
    if (!Array.isArray(point) || point.length !== 2) return false;

    const [lng, lat] = point as unknown[];

    return (
      isFiniteNumber(lng) &&
      isFiniteNumber(lat) &&
      lng >= -180 &&
      lng <= 180 &&
      lat >= -90 &&
      lat <= 90
    );
  });
}

export function IsRouteLineString(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isRouteLineString',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isRouteLineString(value),
        defaultMessage: () =>
          `${propertyName} must be a GeoJSON LineString with 2 to ${MAX_ROUTE_POINTS} [longitude, latitude] points`,
      },
    });
  };
}
