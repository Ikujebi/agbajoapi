import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ChatPrivacy,
  ConversationStatus,
  ConversationType,
  MembershipStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { hasPermission } from "../common/permissions/permissions";

export type ChatVerdict = "ALLOWED" | "REQUEST" | "DENIED";

const MAX_MESSAGE_LENGTH = 5000;
const MESSAGE_PAGE_SIZE = 50;
const MAX_CONVERSATIONS = 100;

type DirectConversation = Prisma.ConversationGetPayload<object> & {
  type: "DIRECT";
  userAId: string;
  userBId: string;
};

function sortUserPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensures that a conversation is a valid direct conversation.
   * The schema permits nullable participant IDs because it also supports
   * group, organization, and support conversations.
   */
  private assertDirectConversation(
    conversation: Prisma.ConversationGetPayload<object>,
  ): asserts conversation is DirectConversation {
    if (
      conversation.type !== "DIRECT" ||
      !conversation.userAId ||
      !conversation.userBId
    ) {
      throw new BadRequestException(
        "This operation only supports direct conversations",
      );
    }
  }

  private findConversation(userId: string, otherUserId: string) {
    const [userAId, userBId] = sortUserPair(userId, otherUserId);

    return this.prisma.conversation.findUnique({
      where: {
        userAId_userBId: {
          userAId,
          userBId,
        },
      },
    });
  }

  private async assertActiveUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new NotFoundException("User not found");
    }
  }

  /**
   * Used by the WebSocket gateway to verify that the authenticated
   * user still exists and is active.
   */
  async assertSocketUserActive(userId: string): Promise<void> {
    await this.assertActiveUser(userId);
  }

  /**
   * A block in either direction prevents communication.
   */
  private async isBlocked(userAId: string, userBId: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userAId, blockedId: userBId },
          { blockerId: userBId, blockedId: userAId },
        ],
      },
      select: { id: true },
    });

    return Boolean(block);
  }

  private async ensureConversationMembers(
    conversationId: string,
    userAId: string,
    userBId: string,
  ): Promise<void> {
    await this.prisma.conversationMember.createMany({
      data: [
        { conversationId, userId: userAId },
        { conversationId, userId: userBId },
      ],
      skipDuplicates: true,
    });
  }

  /**
   * Returns true when adminId is an approved organization owner/admin
   * and memberId has an approved membership in the same organization.
   */
  private async isAdminOfOrgWhereMember(adminId: string, memberId: string) {
    const adminMemberships = await this.prisma.membership.findMany({
      where: { userId: adminId, status: MembershipStatus.APPROVED },
      select: {
        organizationId: true,
        role: true,
        organization: { select: { type: true } },
      },
    });

    const managed = adminMemberships
      .filter((m) =>
        hasPermission(m.organization.type, m.role, "members.manage"),
      )
      .map((m) => m.organizationId);

    if (managed.length === 0) return false;

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: memberId,
        status: MembershipStatus.APPROVED,
        organizationId: { in: managed },
      },
      select: { id: true },
    });

    return Boolean(membership);
  }

  private async shareOrganization(
    userAId: string,
    userBId: string,
  ): Promise<boolean> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId: userAId,
        status: MembershipStatus.APPROVED,
      },
      select: { organizationId: true },
    });

    if (memberships.length === 0) {
      return false;
    }

    const sharedMembership = await this.prisma.membership.findFirst({
      where: {
        userId: userBId,
        status: MembershipStatus.APPROVED,
        organizationId: {
          in: memberships.map((item) => item.organizationId),
        },
      },
      select: { id: true },
    });

    return Boolean(sharedMembership);
  }

  /**
   * Determines whether a sender may start a direct conversation.
   * Blocks take precedence over privacy exceptions.
   */
  async canStart(senderId: string, recipientId: string): Promise<ChatVerdict> {
    if (senderId === recipientId) {
      throw new BadRequestException("You cannot message yourself");
    }

    if (await this.isBlocked(senderId, recipientId)) {
      return "DENIED";
    }

    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: {
        id: true,
        isActive: true,
        chatPrivacy: true,
      },
    });

    if (!recipient || !recipient.isActive) {
      throw new NotFoundException("User not found");
    }

    // Preserve the existing organization admin/owner exception.
    if (await this.isAdminOfOrgWhereMember(senderId, recipientId)) {
      return "ALLOWED";
    }

    if (await this.isAdminOfOrgWhereMember(recipientId, senderId)) {
      return "ALLOWED";
    }

    switch (recipient.chatPrivacy) {
      case ChatPrivacy.EVERYONE:
        return "ALLOWED";

      case ChatPrivacy.MY_ORGS_ONLY:
        return (await this.shareOrganization(senderId, recipientId))
          ? "ALLOWED"
          : "DENIED";

      case ChatPrivacy.REQUEST_ONLY:
        return "REQUEST";

      case ChatPrivacy.ADMINS_ONLY:
        return "DENIED";

      default:
        return "DENIED";
    }
  }

  /**
   * Sends a message or initiates a message request.
   */
  async send(
    senderId: string,
    recipientId: string,
    text?: string,
    media?: {
      url: string;
      type: import("@prisma/client").MessageType;
      fileName?: string;
      mimeType?: string;
      size?: number;
      publicId?: string;
    },
  ) {
    if (senderId === recipientId) {
      throw new BadRequestException("You cannot message yourself");
    }

    const body = typeof text === "string" ? text.trim() : "";
    if (!body && !media?.url) {
      throw new BadRequestException(
        "Message must contain text or a media file",
      );
    }
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
      );
    }
    if (media && (!media.url || !media.type)) {
      throw new BadRequestException("A valid media URL and type are required");
    }

    await Promise.all([
      this.assertActiveUser(senderId),
      this.assertActiveUser(recipientId),
    ]);

    if (await this.isBlocked(senderId, recipientId)) {
      throw new ForbiddenException("Messaging is blocked between these users");
    }

    let conversation = await this.findConversation(senderId, recipientId);

    let createdByThisRequest = false;

    if (!conversation) {
      const verdict = await this.canStart(senderId, recipientId);

      if (verdict === "DENIED") {
        throw new ForbiddenException(
          "This user is not accepting messages from you",
        );
      }

      const [userAId, userBId] = sortUserPair(senderId, recipientId);

      try {
        conversation = await this.prisma.conversation.create({
          data: {
            type: ConversationType.DIRECT,
            userAId,
            userBId,
            initiatorId: senderId,
            status:
              verdict === "REQUEST"
                ? ConversationStatus.REQUESTED
                : ConversationStatus.ACTIVE,
          },
        });

        createdByThisRequest = true;
      } catch (error) {
        // Another request may have created the unique direct pair
        // between the initial lookup and the create operation.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          conversation = await this.findConversation(senderId, recipientId);
        } else {
          throw error;
        }
      }

      if (!conversation) {
        throw new BadRequestException(
          "Unable to start the conversation. Please try again.",
        );
      }
    }

    if (!createdByThisRequest) {
      if (await this.isBlocked(senderId, recipientId)) {
        throw new ForbiddenException(
          "Messaging is blocked between these users",
        );
      }

      if (
        conversation.status === ConversationStatus.DECLINED &&
        conversation.initiatorId === senderId
      ) {
        throw new ForbiddenException("Your message request was declined");
      }

      if (conversation.status === ConversationStatus.REQUESTED) {
        if (conversation.initiatorId === senderId) {
          throw new ForbiddenException(
            "Wait for the recipient to accept your message request",
          );
        }

        // A reply from the recipient accepts the pending request.
        conversation = await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: ConversationStatus.ACTIVE,
          },
        });
      } else if (conversation.status === ConversationStatus.DECLINED) {
        // The recipient who declined can start messaging again.
        conversation = await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: ConversationStatus.ACTIVE,
          },
        });
      }
    }

    if (
      conversation.status !== ConversationStatus.ACTIVE &&
      conversation.status !== ConversationStatus.REQUESTED
    ) {
      throw new ForbiddenException("This conversation is not available");
    }

    this.assertDirectConversation(conversation);

    await this.ensureConversationMembers(
      conversation.id,
      conversation.userAId,
      conversation.userBId,
    );

    const message = await this.prisma.$transaction(async (tx) => {
      const createdMessage = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId,
          body: body || null,
          type: media?.type ?? "TEXT",
          mediaUrl: media?.url ?? null,
          mediaPublicId: media?.publicId ?? null,
          mediaFileName: media?.fileName ?? null,
          mediaMimeType: media?.mimeType ?? null,
          mediaSize: media?.size ?? null,
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      return createdMessage;
    });

    return {
      message,
      conversation,
    };
  }

  /**
   * Edits the sender's message only during the first 60 seconds.
   * The database update is conditional, so an expired edit window cannot
   * be bypassed by a client-side clock.
   */
  async updateMessage(userId: string, messageId: string, newText: string) {
    const body = typeof newText === "string" ? newText.trim() : "";
    if (!body) {
      throw new BadRequestException("Updated message body cannot be empty");
    }
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
      );
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message || message.deletedAt) {
      throw new NotFoundException("Message not found");
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException("You can only edit your own messages");
    }

    this.assertDirectConversation(message.conversation);
    if (
      ![message.conversation.userAId, message.conversation.userBId].includes(
        userId,
      )
    ) {
      throw new NotFoundException("Message not found");
    }
    if (message.conversation.status !== ConversationStatus.ACTIVE) {
      throw new ForbiddenException("This conversation is not active");
    }
    if (
      await this.isBlocked(
        message.conversation.userAId,
        message.conversation.userBId,
      )
    ) {
      throw new ForbiddenException("Messaging is blocked between these users");
    }

    const cutoff = new Date(Date.now() - 60_000);
    const now = new Date();
    const result = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        senderId: userId,
        deletedAt: null,
        createdAt: { gte: cutoff },
      },
      data: { body, isEdited: true, editedAt: now },
    });
    if (result.count !== 1) {
      throw new BadRequestException(
        "Messages can only be edited within 1 minute of sending",
      );
    }

    return this.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
  }

  /**
   * Soft-deletes a message authored by the requesting user.
   * Media is hidden from chat history; asset cleanup can be performed separately.
   */
  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message || message.deletedAt) {
      throw new NotFoundException("Message not found");
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException("You can only delete your own messages");
    }

    this.assertDirectConversation(message.conversation);
    if (
      ![message.conversation.userAId, message.conversation.userBId].includes(
        userId,
      )
    ) {
      throw new NotFoundException("Message not found");
    }

    const deletedAt = new Date();
    const result = await this.prisma.message.updateMany({
      where: { id: messageId, senderId: userId, deletedAt: null },
      data: {
        deletedAt,
        body: null,
        mediaUrl: null,
        mediaPublicId: null,
        mediaFileName: null,
        mediaMimeType: null,
        mediaSize: null,
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException("Message not found");
    }

    return { id: messageId, conversationId: message.conversationId, deletedAt };
  }

  /**
   * Accepts or declines a pending direct message request.
   */
  async respondToRequest(
    userId: string,
    conversationId: string,
    accept: boolean,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    this.assertDirectConversation(conversation);

    if (![conversation.userAId, conversation.userBId].includes(userId)) {
      throw new NotFoundException("Conversation not found");
    }

    if (
      conversation.status !== ConversationStatus.REQUESTED ||
      conversation.initiatorId === userId
    ) {
      throw new BadRequestException("No pending request to answer");
    }

    if (await this.isBlocked(conversation.userAId, conversation.userBId)) {
      throw new ForbiddenException("Messaging is blocked between these users");
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: accept
          ? ConversationStatus.ACTIVE
          : ConversationStatus.DECLINED,
      },
    });

    this.assertDirectConversation(updated);

    await this.ensureConversationMembers(
      updated.id,
      updated.userAId,
      updated.userBId,
    );

    return updated;
  }

  /**
   * Lists a user's direct conversations.
   *
   * When requestsOnly is true, only pending requests received
   * from other users are returned.
   */
  async conversations(userId: string, requestsOnly = false) {
    await this.assertActiveUser(userId);

    const items = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.DIRECT,
        OR: [{ userAId: userId }, { userBId: userId }],
        ...(requestsOnly
          ? {
              status: ConversationStatus.REQUESTED,
              NOT: { initiatorId: userId },
            }
          : {
              status: {
                in: [ConversationStatus.ACTIVE, ConversationStatus.REQUESTED],
              },
            }),
      },
      include: {
        userA: {
          select: {
            id: true,
            firstName: true,
            otherNames: true,
            lastName: true,
            avatarUrl: true,
          },
        },
        userB: {
          select: {
            id: true,
            firstName: true,
            otherNames: true,
            lastName: true,
            avatarUrl: true,
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: MAX_CONVERSATIONS,
    });

    // Hide conversation previews when either participant has
    // blocked the other.
    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: {
        blockerId: true,
        blockedId: true,
      },
    });

    const blockedUserIds = new Set<string>();

    for (const block of blocks) {
      blockedUserIds.add(
        block.blockerId === userId ? block.blockedId : block.blockerId,
      );
    }

    return items
      .filter((item) => {
        const otherUserId =
          item.userAId === userId ? item.userBId : item.userAId;

        return otherUserId !== null && !blockedUserIds.has(otherUserId);
      })
      .map((item) => {
        const otherUser = item.userAId === userId ? item.userB : item.userA;

        return {
          id: item.id,
          status: item.status,
          initiatorId: item.initiatorId,
          other: otherUser
            ? {
                ...otherUser,
                displayName: [
                  otherUser.firstName,
                  otherUser.otherNames,
                  otherUser.lastName,
                ]
                  .filter((name) => name?.trim())
                  .join(" "),
              }
            : null,
          lastMessage: item.messages[0] ?? null,
        };
      });
  }

  /**
   * Retrieves the newest 50 messages, or the next page before
   * the supplied message cursor.
   */
  async messages(userId: string, conversationId: string, cursor?: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    this.assertDirectConversation(conversation);

    if (![conversation.userAId, conversation.userBId].includes(userId)) {
      throw new NotFoundException("Conversation not found");
    }

    if (conversation.status !== ConversationStatus.ACTIVE) {
      throw new ForbiddenException(
        "Accept this message request to view the conversation",
      );
    }

    if (await this.isBlocked(conversation.userAId, conversation.userBId)) {
      throw new ForbiddenException("Messaging is blocked between these users");
    }

    if (cursor) {
      const cursorMessage = await this.prisma.message.findFirst({
        where: {
          id: cursor,
          conversationId,
        },
        select: { id: true },
      });

      if (!cursorMessage) {
        throw new BadRequestException("Invalid message cursor");
      }
    }

    await this.ensureConversationMembers(
      conversation.id,
      conversation.userAId,
      conversation.userBId,
    );

    await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: {
        lastReadAt: new Date(),
      },
    });

    return this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MESSAGE_PAGE_SIZE,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    });
  }

  /**
   * Explicitly updates the current user's read position.
   */
  async markRead(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    this.assertDirectConversation(conversation);

    if (![conversation.userAId, conversation.userBId].includes(userId)) {
      throw new NotFoundException("Conversation not found");
    }

    if (conversation.status !== ConversationStatus.ACTIVE) {
      throw new ForbiddenException("This conversation is not active");
    }

    if (await this.isBlocked(conversation.userAId, conversation.userBId)) {
      throw new ForbiddenException("Messaging is blocked between these users");
    }

    await this.ensureConversationMembers(
      conversation.id,
      conversation.userAId,
      conversation.userBId,
    );

    const lastReadAt = new Date();

    await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId,
      },
      data: { lastReadAt },
    });

    return {
      conversationId,
      userId,
      lastReadAt,
    };
  }

  /**
   * Returns participant IDs for an authorized conversation.
   */
  async getConversationParticipants(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        type: true,
        userAId: true,
        userBId: true,
      },
    });

    if (
      !conversation ||
      conversation.type !== "DIRECT" ||
      !conversation.userAId ||
      !conversation.userBId ||
      ![conversation.userAId, conversation.userBId].includes(userId)
    ) {
      throw new NotFoundException("Conversation not found");
    }

    return {
      userAId: conversation.userAId,
      userBId: conversation.userBId,
      otherUserId:
        conversation.userAId === userId
          ? conversation.userBId
          : conversation.userAId,
    };
  }

  /**
   * Updates the user's chat privacy setting.
   */
  async setPrivacy(userId: string, chatPrivacy: ChatPrivacy) {
    await this.assertActiveUser(userId);

    return this.prisma.user.update({
      where: { id: userId },
      data: { chatPrivacy },
      select: {
        id: true,
        chatPrivacy: true,
      },
    });
  }

  /**
   * Blocks another user. The unique constraint prevents duplicate
   * block records for the same direction.
   */
  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException("You cannot block yourself");
    }

    await Promise.all([
      this.assertActiveUser(blockerId),
      this.assertActiveUser(blockedId),
    ]);

    await this.prisma.block.upsert({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId,
        },
      },
      create: {
        blockerId,
        blockedId,
      },
      update: {},
    });

    return { ok: true };
  }

  /**
   * Removes a block created by the requesting user.
   */
  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({
      where: {
        blockerId,
        blockedId,
      },
    });

    return { ok: true };
  }
}
