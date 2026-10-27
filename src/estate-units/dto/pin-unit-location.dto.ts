import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { Trim } from './trim';
import {
  IsRouteLineString,
  RouteLineString,
} from './is-route-line-string.validator';

export class PinUnitLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** Plain-words help for the last stretch, e.g. "Green gate, third house after the water tank". */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  directions?: string | null;

  /** Optional walking/driving line from the estate gate to the door. Send null to remove it. */
  @IsOptional()
  @IsRouteLineString()
  routeGeoJson?: RouteLineString | null;
}
