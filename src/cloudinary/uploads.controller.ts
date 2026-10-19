import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CloudinaryService } from './cloudinary.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FOLDERS = ['avatars', 'org-logos', 'org-covers', 'products', 'listings'];

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly cloudinary: CloudinaryService) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_BYTES }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp|avif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body('folder') folder: string,
  ) {
    if (!ALLOWED_FOLDERS.includes(folder)) {
      throw new BadRequestException(
        `folder must be one of: ${ALLOWED_FOLDERS.join(', ')}`,
      );
    }
    return this.cloudinary.uploadImage(file, `neighborhood/${folder}`);
  }
}