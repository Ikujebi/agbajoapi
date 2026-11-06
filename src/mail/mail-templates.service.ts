import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import type {
  MailTemplate,
  MailTemplateDefinition,
} from './mail.types';

@Injectable()
export class MailTemplatesService {
  private readonly logger = new Logger(
    MailTemplatesService.name,
  );

  /**
   * Renders a reusable email template.
   *
   * Accepts any template function from the template library.
   */
  render<TOptions>(
    template: MailTemplate<TOptions>,
    options: TOptions,
  ): string {
    if (typeof template !== 'function') {
      throw new InternalServerErrorException(
        'Invalid email template.',
      );
    }

    try {
      const html = template(options);

      if (typeof html !== 'string' || !html.trim()) {
        throw new Error('Template returned empty HTML.');
      }

      return html;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown template rendering error';

      this.logger.error(
        `Email template rendering failed: ${message}`,
      );

      throw new InternalServerErrorException(
        'Unable to render email template.',
      );
    }
  }

  /**
   * Renders a registered template definition.
   *
   * Useful when templates are stored in a template registry.
   */
  renderDefinition<TOptions>(
    definition: MailTemplateDefinition<TOptions>,
    options: TOptions,
  ): string {
    if (
      !definition ||
      typeof definition.generate !== 'function'
    ) {
      throw new InternalServerErrorException(
        'Invalid email template definition.',
      );
    }

    return this.render(definition.generate, options);
  }
}