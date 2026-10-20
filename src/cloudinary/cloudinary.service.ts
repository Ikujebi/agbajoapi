
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.getOrThrow<string>(
        'CLOUDINARY_CLOUD_NAME',
      ),
      api_key: this.config.getOrThrow<string>(
        'CLOUDINARY_API_KEY',
      ),
      api_secret: this.config.getOrThrow<string>(
        'CLOUDINARY_API_SECRET',
      ),
      secure: true,
    });
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<{
    url: string;
    publicId: string;
    width: number;
    height: number;
    format: string;
  }> {
    if (!file?.buffer || file.size === 0) {
      throw new InternalServerErrorException(
        'A valid file buffer is required',
      );
    }

    try {
      const result = await new Promise<UploadApiResponse>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder,
              resource_type: 'image',
              allowed_formats: [
                'jpg',
                'jpeg',
                'png',
                'webp',
                'avif',
              ],
            },
            (
              error:
                | UploadApiErrorResponse
                | undefined,
              response: UploadApiResponse | undefined,
            ) => {
              if (error) {
                reject(error);
                return;
              }

              if (!response) {
                reject(new Error('Cloudinary returned no result'));
                return;
              }

              resolve(response);
            },
          );

          Readable.from(file.buffer).pipe(stream);
        },
      );

      return {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
      };
    } catch (error) {
      this.logger.error('Cloudinary image upload failed');

      throw new InternalServerErrorException(
        'Image upload failed. Please try again.',
      );
    }
  }

  async deleteAsset(publicId: string): Promise<void> {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
        invalidate: true,
      });

      if (
        result.result !== 'ok' &&
        result.result !== 'not found'
      ) {
        throw new Error('Cloudinary asset deletion failed');
      }
    } catch {
      this.logger.error('Cloudinary asset deletion failed');

      throw new InternalServerErrorException(
        'Could not delete the media asset',
      );
    }
  }
  
  /**
   * Upload chat attachments. Images use image resources, video/audio use video,
   * and documents/other files use raw resources. MIME allow-listing must also be
   * enforced by the controller.
   */
  async uploadChatMedia(
    file: Express.Multer.File,
    folder: string,
  ): Promise<{ url: string; publicId: string; resourceType: 'image' | 'video' | 'raw'; format: string }> {
    if (!file?.buffer || file.size === 0) {
      throw new InternalServerErrorException('A valid file buffer is required');
    }

    const resourceType: 'image' | 'video' | 'raw' =
      file.mimetype.startsWith('image/') ? 'image' :
      (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) ? 'video' : 'raw';

    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: resourceType,
            use_filename: true,
            unique_filename: true,
            filename_override: file.originalname,
          },
          (error: UploadApiErrorResponse | undefined, response: UploadApiResponse | undefined) => {
            if (error) return reject(error);
            if (!response) return reject(new Error('Cloudinary returned no result'));
            resolve(response);
          },
        );
        Readable.from(file.buffer).pipe(stream);
      });
      return {
        url: result.secure_url,
        publicId: result.public_id,
        resourceType,
        format: result.format,
      };
    } catch {
      this.logger.error('Cloudinary chat media upload failed');
      throw new InternalServerErrorException('Media upload failed. Please try again.');
    }
  }

}
