import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { Room } from '../rooms/entities/room.entity';
import {
  BookingHoldItem,
  BookingHoldItemStatus,
} from './entities/booking-hold-item.entity';

export interface MultiRoomCartLineInput {
  roomTypeId: string;
  ratePlanId?: string | null;
  quantity: number;
  adults?: number;
  children?: number;
  unitBasePriceVnd?: number;
}

@Injectable()
export class MultiLineHoldService {
  /**
   * Atomically locks all requested room types in ascending ID order, validates capacity
   * across every line, and creates `booking_hold_items` in a single transaction.
   * If any room type fails availability, throws ConflictException so the whole cart rolls back.
   */
  async createHoldsAtomic(
    em: EntityManager,
    params: {
      holdId: string;
      bookingId: string;
      hotelId: string;
      lines: MultiRoomCartLineInput[];
      checkInDate: string;
      checkOutDate: string;
      expiresAt: Date;
      getFreeCapacityForRoomType?: (roomTypeId: string, em: EntityManager) => Promise<number>;
    },
  ): Promise<BookingHoldItem[]> {
    if (!params.lines || params.lines.length === 0) {
      throw new BadRequestException('Giỏ đặt phòng đa dòng (lines) không được rỗng.');
    }

    const sortedRoomTypeIds = Array.from(
      new Set(params.lines.map((l) => String(l.roomTypeId))),
    ).sort((a, b) => Number(a) - Number(b));

    const rooms = await em
      .getRepository(Room)
      .createQueryBuilder('r')
      .setLock('pessimistic_write')
      .where('r.id IN (:...ids)', { ids: sortedRoomTypeIds })
      .orderBy('r.id', 'ASC')
      .getMany();

    if (rooms.length !== sortedRoomTypeIds.length) {
      throw new NotFoundException('Một hoặc nhiều loại phòng trong giỏ không tồn tại.');
    }

    const roomMap = new Map<string, Room>();
    for (const room of rooms) {
      if (String(room.hotelId) !== String(params.hotelId)) {
        throw new BadRequestException(
          `Loại phòng #${room.id} không thuộc khách sạn #${params.hotelId}. Không cho phép 1 booking đặt nhiều khách sạn.`,
        );
      }
      roomMap.set(String(room.id), room);
    }

    // Aggregate requested quantity per roomTypeId across lines
    const requestedByRoomType = new Map<string, number>();
    for (const line of params.lines) {
      const qty = Number(line.quantity || 0);
      if (qty <= 0) {
        throw new BadRequestException('Số lượng phòng mỗi dòng phải lớn hơn 0.');
      }
      const rtId = String(line.roomTypeId);
      requestedByRoomType.set(rtId, (requestedByRoomType.get(rtId) || 0) + qty);
    }

    for (const [rtId, totalReqQty] of requestedByRoomType.entries()) {
      const room = roomMap.get(rtId)!;
      const freeCapacity = params.getFreeCapacityForRoomType
        ? await params.getFreeCapacityForRoomType(rtId, em)
        : Number(room.availableRooms ?? room.totalRooms ?? 0);
      if (freeCapacity < totalReqQty) {
        throw new ConflictException(
          `MULTI_LINE_CAPACITY_EXHAUSTED: Loại phòng "${room.name}" chỉ còn ${freeCapacity} phòng trống, không đủ ${totalReqQty} phòng yêu cầu.`,
        );
      }
    }

    const savedItems: BookingHoldItem[] = [];
    for (let i = 0; i < params.lines.length; i++) {
      const line = params.lines[i];
      const room = roomMap.get(String(line.roomTypeId))!;
      const item = em.getRepository(BookingHoldItem).create({
        holdId: String(params.holdId),
        bookingId: String(params.bookingId),
        hotelId: String(params.hotelId),
        roomTypeId: String(line.roomTypeId),
        ratePlanId: line.ratePlanId ? String(line.ratePlanId) : null,
        lineIndex: i,
        quantity: Number(line.quantity),
        adults: Number(line.adults ?? 2),
        children: Number(line.children ?? 0),
        unitBasePriceVnd: Number(line.unitBasePriceVnd ?? room.pricePerNight ?? 0),
        checkInDate: params.checkInDate,
        checkOutDate: params.checkOutDate,
        status: BookingHoldItemStatus.HELD,
        expiresAt: params.expiresAt,
      });
      savedItems.push(await em.getRepository(BookingHoldItem).save(item));
    }

    return savedItems;
  }

  async commitAllHoldItems(bookingId: string, em: EntityManager): Promise<number> {
    const items = await em.getRepository(BookingHoldItem).find({
      where: {
        bookingId: String(bookingId),
        status: In([BookingHoldItemStatus.HELD, BookingHoldItemStatus.COMMITTED]),
      },
    });
    if (items.length === 0) return 0;

    for (const item of items) {
      if (item.status !== BookingHoldItemStatus.COMMITTED) {
        item.status = BookingHoldItemStatus.COMMITTED;
        item.committedAt = new Date();
        await em.getRepository(BookingHoldItem).save(item);
      }
    }
    return items.length;
  }

  async releaseAllHoldItems(bookingId: string, em: EntityManager): Promise<number> {
    const items = await em.getRepository(BookingHoldItem).find({
      where: {
        bookingId: String(bookingId),
        status: In([BookingHoldItemStatus.HELD, BookingHoldItemStatus.COMMITTED]),
      },
    });
    for (const item of items) {
      item.status = BookingHoldItemStatus.RELEASED;
      item.releasedAt = new Date();
      await em.getRepository(BookingHoldItem).save(item);
    }
    return items.length;
  }
}
