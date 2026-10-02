import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const reactionSelect = { emoji: true, username: true } as const;

@Injectable()
export class RoomService {
  constructor(private prisma: PrismaService) {}

  async createRoom(name: string) {
    return this.prisma.room.create({
      data: { name },
    });
  }

  async getAllRooms() {
    return this.prisma.room.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });
  }

  async getRoomById(id: string) {
    return this.prisma.room.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
          include: {
            reactions: { select: reactionSelect, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
  }

  async getRoomMessages(roomId: string, limit = 50) {
    return this.prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async createMessage(roomId: string, username: string, content: string) {
    return this.prisma.message.create({
      data: {
        roomId,
        username,
        content,
      },
    });
  }

  // Ownership is enforced in the WHERE clause, so the check and write are atomic.
  async editMessage(roomId: string, messageId: string, username: string, content: string) {
    const editedAt = new Date();
    const { count } = await this.prisma.message.updateMany({
      where: { id: messageId, roomId, username },
      data: { content, editedAt },
    });
    return count > 0 ? { id: messageId, content, editedAt } : null;
  }

  async deleteMessage(roomId: string, messageId: string, username: string) {
    const { count } = await this.prisma.message.deleteMany({
      where: { id: messageId, roomId, username },
    });
    return count > 0;
  }

  /**
   * Idempotently adds or removes one user's reaction. Returns false when the
   * message isn't in the given room.
   */
  async setReaction(
    roomId: string,
    messageId: string,
    username: string,
    emoji: string,
    active: boolean,
  ) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, roomId },
      select: { id: true },
    });
    if (!message) return false;

    if (active) {
      try {
        await this.prisma.reaction.create({ data: { messageId, username, emoji } });
      } catch (error) {
        // Already present (e.g. another tab added it): the desired state holds.
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
      }
    } else {
      await this.prisma.reaction.deleteMany({ where: { messageId, username, emoji } });
    }
    return true;
  }
}
