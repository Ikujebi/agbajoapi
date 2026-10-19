
import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(254)
    identifier!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(72)
    password!: string;
}
