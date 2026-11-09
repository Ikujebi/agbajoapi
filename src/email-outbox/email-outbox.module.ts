import { Global, Module } from '@nestjs/common';

import { EmailOutboxService } from './email-outbox.service';
import { EmailOutboxProcessor } from './email-outbox.processor';

@Global()
@Module({
  providers: [EmailOutboxService, EmailOutboxProcessor],
  exports: [EmailOutboxService],
})
export class EmailOutboxModule {}