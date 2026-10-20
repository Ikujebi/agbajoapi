
import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SosController } from './sos.controller';
import { SosService } from './sos.service';

@Module({
  imports: [PrismaModule],
  controllers: [SosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
