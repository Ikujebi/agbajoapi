import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { UploadsController } from './uploads.controller';

@Module({
  providers: [CloudinaryService],
  controllers: [UploadsController],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}