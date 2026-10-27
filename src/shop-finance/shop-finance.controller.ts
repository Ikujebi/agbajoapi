import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseEnumPipe,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ExpenseCategory } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ExpensesService } from './expenses.service';
import { FinanceService } from './finance.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller()
export class FinanceController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly finance: FinanceService,
  ) {}

  // ---------- expenses ----------

  @Post('organizations/:orgId/expenses')
  create(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expenses.create(user, orgId, dto);
  }

  @Get('organizations/:orgId/expenses')
  list(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('category', new ParseEnumPipe(ExpenseCategory, { optional: true }))
    category?: ExpenseCategory,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.expenses.list(user, orgId, { category, from, to });
  }

  @Patch('expenses/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenses.update(user, id, dto);
  }

  @Delete('expenses/:id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.expenses.remove(user, id);
  }

  /** POST /api/expenses/:id/receipt (multipart, field name "file") */
  @Post('expenses/:id/receipt')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }),
  )
  receipt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_RECEIPT_BYTES }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp|avif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.expenses.attachReceipt(user, id, file);
  }

  // ---------- reports ----------

  /** GET /api/shops/:orgId/finance/summary?from=&to= */
  @Get('shops/:orgId/finance/summary')
  summary(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.finance.summary(user, orgId, from, to);
  }

  /** GET /api/shops/:orgId/low-stock */
  @Get('shops/:orgId/low-stock')
  lowStock(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.finance.lowStock(user, orgId);
  }
}