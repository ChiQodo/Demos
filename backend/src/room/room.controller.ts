import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { DEFAULT_PAGE_SIZE, RoomService } from './room.service';
import { isUuid } from '../chat/chat.validation';

const MAX_PAGE_SIZE = 100;

@Controller('rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post()
  async createRoom(@Body() body: { name: string }) {
    return this.roomService.createRoom(body.name);
  }

  @Get()
  async getAllRooms() {
    return this.roomService.getAllRooms();
  }

  @Get(':id')
  async getRoomById(@Param('id', ParseUUIDPipe) id: string) {
    const room = await this.roomService.getRoomById(id);
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  @Get(':id/messages')
  async getRoomMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('before') before?: string,
    @Query('limit') limitParam?: string,
  ) {
    if (before !== undefined && !isUuid(before)) {
      throw new BadRequestException('before must be a message id');
    }
    if (limitParam !== undefined && !/^\d+$/.test(limitParam)) {
      throw new BadRequestException('limit must be a positive integer');
    }
    const limit = limitParam === undefined ? DEFAULT_PAGE_SIZE : Number(limitParam);
    if (limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new BadRequestException(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    }

    const page = await this.roomService.getRoomMessages(id, before, limit);
    if (!page) throw new NotFoundException('Message not found in this room');
    return page;
  }
}
