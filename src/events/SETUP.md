# Event invitations: email, SMS, copy/share text, and optional images

## Files
Copy the TypeScript files and `dto/` into your `events/` folder.

## Prisma
Add `EventInviteStatus`, `EventInvitation`, and `EventMedia` from `prisma-event-invitation.snippet.prisma`.
Add relation fields:
- `Event`: `invitations EventInvitation[]` and `media EventMedia[]`
- `Organization`: `eventInvitations EventInvitation[]`
- `User`: `eventInvitationsCreated EventInvitation[] @relation("EventInvitationCreator")` and `eventInvitationsChecked EventInvitation[] @relation("EventInvitationChecker")`

Then run:
```bash
npx prisma migrate dev --name event_invitations_and_media
npx prisma generate
```

## Module wiring
`events.module.ts` assumes these paths:
- `../mail/mail.module` exports `MailService`
- `../sms1/sms.module` exports `SmsService`
- `../cloudinary/cloudinary.module` exports `CloudinaryService`

Change those imports to match your actual module paths and ensure each module exports its service. `SmsService.send(phone, body)` and `MailService.send(to, subject, html)` are used as shown in your supplied service examples.

Register these permission keys in your permission definitions and role map:
- `event.create`
- `event.view`
- `event.manage`
- `event.invite`
- `event.checkin`

## Invitation flow
1. Create event using `POST /events`.
2. Publish it using `PATCH /events/:id` with `{"status":"PUBLISHED"}`.
3. Create invitation using `POST /events/:id/invitations`. The response includes `code` and `shareMessage`. Save/copy them immediately; the plaintext code is intentionally never stored.
4. Send/share using `POST /events/:id/invitations/:invitationId/send` with a method and the code returned at creation.

Email:
```json
{"method":"EMAIL","code":"ABCDEFG2","email":"guest@example.com"}
```
SMS:
```json
{"method":"SMS","code":"ABCDEFG2","phone":"+2348012345678"}
```
Copy:
```json
{"method":"COPY","code":"ABCDEFG2"}
```
Manual WhatsApp or any messaging app:
```json
{"method":"MESSAGE","code":"ABCDEFG2"}
```
`COPY` and `MESSAGE` return `shareMessage`; your frontend can put it on the clipboard or let the sender paste it into WhatsApp, Telegram, etc. The backend does not send WhatsApp messages directly.

## Event images
Upload up to five images (5 MB each) using multipart/form-data:
`POST /events/:id/images`
- Field name: `images` (repeat for each image)
- Allowed MIME types: JPEG, PNG, WEBP, AVIF
- Images are uploaded to Cloudinary and metadata is saved in `EventMedia`.
- The controller uses in-memory Multer storage; configure your app's upload limits appropriately.

## Notes
- Codes are generated randomly, stored only as SHA-256 hashes, and returned in plaintext only at creation. For security, avoid logging response bodies containing codes.
- Delivery failures do not invalidate the created invitation. The frontend should retain the code/message from the create response so the sender can retry or share manually.
- The event image upload endpoint returns image records. Deleting an event cascades the database rows, but Cloudinary asset cleanup should be added to your event deletion workflow if you later implement deletion.
