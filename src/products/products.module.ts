import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({ imports: [OrganizationsModule], providers: [ProductsService], controllers: [ProductsController] })
export class ProductsModule {}
