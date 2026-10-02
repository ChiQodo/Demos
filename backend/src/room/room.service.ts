import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const reactionSelect = { emoji: true, username: true } as const;

const messageInclude = {
  reactions: { select: reactionSelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.MessageInclude;

export const DEFAULT_PAGE_SIZE = 50;

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

  /** The room with its newest page of messages (oldest first). */
  async getRoomById(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) return null;
    const page = await this.getRoomMessages(id, undefined, DEFAULT_PAGE_SIZE);
    return { ...room, messages: page?.messages ?? [], hasMoreMessages: page?.hasMore ?? false };
  }

  /**
   * One page of messages older than `before` (or the newest page), returned
   * oldest first. Returns null when `before` isn't a message in this room.
   */
  async getRoomMessages(roomId: string, before?: string, limit = DEFAULT_PAGE_SIZE) {
    let where: Prisma.MessageWhereInput = { roomId };
    if (before) {
      const cursor = await this.prisma.message.findFirst({
        where: { id: before, roomId },
        select: { id: true, createdAt: true },
      });
      if (!cursor) return null;
      // (createdAt, id) keyset so messages sharing a timestamp aren't skipped.
      where = {
        roomId,
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      };
    }

    const rows = await this.prisma.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: messageInclude,
    });
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse(), hasMore };
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
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
        // P2003: the message was deleted after the lookup above.
        if (error.code === 'P2003') return false;
        // P2002: already present (e.g. another tab added it); desired state holds.
        if (error.code !== 'P2002') throw error;
      }
    } else {
      await this.prisma.reaction.deleteMany({ where: { messageId, username, emoji } });
    }
    return true;
  }
}
