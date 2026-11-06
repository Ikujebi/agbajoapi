import { Global, Module } from '@nestjs/common';

import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { MailTemplatesService } from './mail-templates.service';

@Global()
@Module({
  controllers: [MailController],
  providers: [
    MailService,
    MailTemplatesService,
  ],
  exports: [
    MailService,
    MailTemplatesService,
  ],
})
export class MailModule {}