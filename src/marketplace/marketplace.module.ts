import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { CategoriesService } from './categories.service';
import { ListingImagesService } from './listing-images.service';
import { ListingsService } from './listings.service';
import { MarketplaceController } from './marketplace.controller';

@Module({
  imports: [CloudinaryModule],
  controllers: [MarketplaceController],
  providers: [CategoriesService, ListingsService, ListingImagesService],
})
export class MarketplaceModule {}