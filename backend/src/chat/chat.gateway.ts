import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room.service';
import { RedisService } from '../redis/redis.service';
import {
  isReactionEmoji,
  isUuid,
  normalizeContent,
  normalizeUsername,
} from './chat.validation';

interface JoinRoomPayload {
  roomId: string;
  username: string;
}

interface SetReactionPayload {
  roomId: string;
  messageId: string;
  username: string;
  emoji: string;
  active: boolean;
}

interface EditMessagePayload {
  roomId: string;
  messageId: string;
  content: string;
}

interface DeleteMessagePayload {
  roomId: string;
  messageId: string;
}

// Presence is derived from live sockets, so it can never go stale. It spans
// instances once a Socket.io Redis adapter is configured.
interface ChatSocketData {
  // roomId -> username; also needed because Socket.io empties client.rooms
  // before handleDisconnect runs.
  joinedRooms?: Map<string, string>;
}

type ChatSocket = Socket<any, any, any, ChatSocketData>;

interface SendMessagePayload {
  roomId: string;
  username: string;
  content: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly redisService: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: ChatSocket) {
    for (const roomId of client.data.joinedRooms?.keys() ?? []) {
      await this.broadcastPresence(roomId);
    }
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    const roomId = payload?.roomId;
    const username = normalizeUsername(payload?.username);
    if (!isUuid(roomId) || !username) {
      this.reject(client, 'joinRoom', 'Invalid room or username', roomId);
      return;
    }

    // Join before reading history so no reaction/message update falls in between.
    await client.join(roomId);
    const room = await this.roomService.getRoomById(roomId);
    if (!room) {
      await client.leave(roomId);
      this.reject(client, 'joinRoom', 'Room not found', roomId);
      return;
    }
    // The socket may have left or disconnected while history was loading.
    if (!client.connected || !client.rooms.has(roomId)) return;
    client.emit('roomHistory', room);

    client.to(roomId).emit('userJoined', {
      username,
      timestamp: new Date().toISOString(),
    });

    client.data.joinedRooms = (client.data.joinedRooms ?? new Map()).set(roomId, username);
    await this.broadcastPresence(roomId);

    this.logger.log({ event: 'room_joined', roomId });
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    const roomId = payload?.roomId;
    const username = normalizeUsername(payload?.username);
    if (!isUuid(roomId) || !username) {
      this.reject(client, 'leaveRoom', 'Invalid room or username', roomId);
      return;
    }

    await client.leave(roomId);

    client.to(roomId).emit('userLeft', {
      username,
      timestamp: new Date().toISOString(),
    });

    client.data.joinedRooms?.delete(roomId);
    await this.broadcastPresence(roomId);
    this.logger.log({ event: 'room_left', roomId });
  }

  @SubscribeMessage('setReaction')
  async handleSetReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SetReactionPayload,
  ) {
    const { roomId, messageId, emoji, active } = payload ?? ({} as SetReactionPayload);
    const username = normalizeUsername(payload?.username);
    if (
      !isUuid(roomId) ||
      !isUuid(messageId) ||
      !username ||
      !isReactionEmoji(emoji) ||
      typeof active !== 'boolean'
    ) {
      this.reject(client, 'setReaction', 'Invalid reaction', roomId);
      return;
    }
    // Only members of the room may react, so a client can't touch other rooms.
    if (!client.rooms.has(roomId)) {
      this.reject(client, 'setReaction', 'Join the room first', roomId);
      return;
    }

    const found = await this.roomService.setReaction(roomId, messageId, username, emoji, active);
    if (!found) {
      this.reject(client, 'setReaction', 'Message not found', roomId);
      return;
    }

    // Per-user deltas commute, so clients converge whatever order they arrive in.
    this.server.to(roomId).emit('reactionUpdate', { messageId, emoji, username, active });
    this.logger.log({ event: 'reaction_set', roomId, messageId, active });
  }

  // Identity is the name the socket joined the room with, not a payload field,
  // so a socket can only edit/delete messages under the name it is shown as.
  @SubscribeMessage('editMessage')
  async handleEditMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: EditMessagePayload,
  ) {
    const roomId = payload?.roomId;
    const messageId = payload?.messageId;
    const content = normalizeContent(payload?.content);
    if (!isUuid(roomId) || !isUuid(messageId) || !content) {
      this.reject(client, 'editMessage', 'Invalid edit', roomId);
      return;
    }
    const username = client.data.joinedRooms?.get(roomId);
    if (!username || !client.rooms.has(roomId)) {
      this.reject(client, 'editMessage', 'Join the room first', roomId);
      return;
    }

    const edited = await this.roomService.editMessage(roomId, messageId, username, content);
    if (!edited) {
      this.reject(client, 'editMessage', 'You can only edit your own messages', roomId);
      return;
    }

    this.server.to(roomId).emit('messageEdited', edited);
    this.logger.log({ event: 'message_edited', roomId, messageId });
  }

  @SubscribeMessage('deleteMessage')
  async handleDeleteMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: DeleteMessagePayload,
  ) {
    const roomId = payload?.roomId;
    const messageId = payload?.messageId;
    if (!isUuid(roomId) || !isUuid(messageId)) {
      this.reject(client, 'deleteMessage', 'Invalid delete', roomId);
      return;
    }
    const username = client.data.joinedRooms?.get(roomId);
    if (!username || !client.rooms.has(roomId)) {
      this.reject(client, 'deleteMessage', 'Join the room first', roomId);
      return;
    }

    const deleted = await this.roomService.deleteMessage(roomId, messageId, username);
    if (!deleted) {
      this.reject(client, 'deleteMessage', 'You can only delete your own messages', roomId);
      return;
    }

    this.server.to(roomId).emit('messageDeleted', { id: messageId });
    this.logger.log({ event: 'message_deleted', roomId, messageId });
  }

  private reject(client: Socket, handler: string, reason: string, roomId?: unknown) {
    client.emit('chatError', { event: handler, message: reason });
    this.logger.warn({
      event: 'socket_request_rejected',
      handler,
      reason,
      roomId: isUuid(roomId) ? roomId : undefined,
    });
  }

  // One user may have several tabs open, so usernames are deduped.
  private async broadcastPresence(roomId: string) {
    const sockets = await this.server.in(roomId).fetchSockets();
    const usernames = sockets
      .map((socket) => (socket.data as ChatSocketData).joinedRooms?.get(roomId))
      .filter((username): username is string => Boolean(username));
    const users = [...new Set(usernames)].sort((a, b) => a.localeCompare(b));
    this.server.to(roomId).emit('presenceUpdate', { roomId, users });
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessagePayload,
  ) {
    const { roomId, username, content } = payload;

    // Save message to database
    const message = await this.roomService.createMessage(roomId, username, content);

    // Broadcast to all users in the room (including sender)
    this.server.to(roomId).emit('newMessage', {
      id: message.id,
      content: message.content,
      username: message.username,
      createdAt: message.createdAt,
    });

    // Publish to Redis for multi-instance support
    await this.redisService.publish(
      `room:${roomId}`,
      JSON.stringify({
        id: message.id,
        content: message.content,
        username: message.username,
        createdAt: message.createdAt,
      }),
    );
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; username: string; isTyping: boolean },
  ) {
    const { roomId, username, isTyping } = payload;
    
    client.to(roomId).emit('userTyping', {
      username,
      isTyping,
    });
  }
}
