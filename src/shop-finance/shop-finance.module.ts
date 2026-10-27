import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { ExpensesService } from './expenses.service';
import { FinanceController } from './shop-finance.controller';
import { FinanceService } from './finance.service';
import { InventoryAlertsService } from './inventory-alerts.service';

@Module({
  imports: [CloudinaryModule],
  controllers: [FinanceController],
  providers: [ExpensesService, FinanceService, InventoryAlertsService],
})
export class FinanceModule {}