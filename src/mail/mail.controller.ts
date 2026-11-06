import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

import { MailService } from './mail.service';
import {
  SendBulkMailDto,
  SendMailDto,
} from './dto/send-mail.dto';

@Controller('mail')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class MailController {
  constructor(private readonly mailService: MailService) {}

  /**
   * Send a single platform-level email.
   *
   * Restricted to authenticated super administrators.
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async send(@Body() dto: SendMailDto) {
    const accepted = await this.mailService.send(
      dto.to,
      dto.subject,
      dto.html,
    );

    return {
      success: accepted,
      message: accepted
        ? 'Email accepted by the email provider.'
        : 'Email could not be accepted.',
      data: {
        accepted,
      },
    };
  }

  /**
   * Send platform-level bulk emails.
   *
   * Restricted to authenticated super administrators.
   */
  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  async sendBulk(@Body() dto: SendBulkMailDto) {
    const uniqueRecipients = [
      ...new Set(
        dto.recipients.map((email) =>
          email.trim().toLowerCase(),
        ),
      ),
    ];

    const accepted = await this.mailService.sendBulk(
      uniqueRecipients,
      dto.subject,
      dto.html,
      dto.batchId,
    );

    const safeAccepted = Math.min(
      Math.max(accepted, 0),
      uniqueRecipients.length,
    );

    const failed = uniqueRecipients.length - safeAccepted;

    return {
      success: safeAccepted > 0,
      message:
        safeAccepted === uniqueRecipients.length
          ? 'All emails were accepted by the email provider.'
          : safeAccepted > 0
            ? 'Some emails were accepted by the email provider.'
            : 'No emails were accepted by the email provider.',
      data: {
        totalRecipients: uniqueRecipients.length,
        accepted: safeAccepted,
        failed,
      },
    };
  }
}