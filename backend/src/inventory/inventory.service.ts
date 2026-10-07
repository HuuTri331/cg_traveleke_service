import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BookingHold, BookingHoldStatus } from './entities/booking-hold.entity';
import { Room, RoomStatus } from '../rooms/entities/room.entity';
import { RedisLockService } from '../redis/redis-lock.service';
import { runWithDeadlockRetry } from '../common/database/transaction-retry.helper';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(BookingHold)
    private readonly holdRepo: Repository<BookingHold>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly redisLockService?: RedisLockService,
  ) {}

  /**
   * Tính toán số phòng đã bị chiếm dụng (occupied) trong khoảng thời gian [checkInAt, checkOutAt)
   * Occupied = tổng quantity của COMMITTED holds + active HELD holds (hold_expires_at > NOW())
   */
  async getOccupiedRooms(
    roomId: string,
    checkInAt: Date,
    checkOutAt: Date,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager ? manager.getRepository(BookingHold) : this.holdRepo;
    const now = new Date();

    const qb = repo
      .createQueryBuilder('hold')
      .select('COALESCE(SUM(hold.quantity), 0)', 'occupied')
      .where('hold.room_id = :roomId', { roomId })
      .andWhere('hold.check_in_at < :checkOutAt', { checkOutAt })
      .andWhere('hold.check_out_at > :checkInAt', { checkInAt })
      .andWhere(
        '(hold.status = :committed OR (hold.status = :held AND hold.hold_expires_at > :now))',
        {
          committed: BookingHoldStatus.COMMITTED,
          held: BookingHoldStatus.HELD,
          now,
        },
      );

    const result = await qb.getRawOne();
    return Number(result?.occupied || 0);
  }

  /**
   * Kiểm tra availability theo khoảng thời gian [checkInAt, checkOutAt)
   */
  async checkAvailability(
    roomId: string,
    checkInAt: Date,
    checkOutAt: Date,
    manager?: EntityManager,
  ) {
    const roomRepo = manager ? manager.getRepository(Room) : this.roomRepo;
    const room = await roomRepo.findOne({ where: { id: roomId } });

    if (!room) {
      throw new NotFoundException('Không tìm thấy thông tin phòng.');
    }

    const occupied = await this.getOccupiedRooms(
      roomId,
      checkInAt,
      checkOutAt,
      manager,
    );
    const available = Math.max(0, room.totalRooms - occupied);

    return {
      room,
      totalRooms: room.totalRooms,
      occupied,
      available,
      isAvailable: available > 0,
    };
  }

  /**
   * Giữ chỗ tạm thời (HOLD) theo khoảng thời gian lưu trú [checkInAt, checkOutAt)
   * Sử dụng Redis Lock + MySQL Pessimistic Row Lock (SELECT FOR UPDATE) + Deadlock Retry
   */
  async reserveHold(
    params: {
      bookingId: string;
      roomId: string;
      quantity: number;
      checkInAt: Date;
      checkOutAt: Date;
      holdMinutes?: number;
    },
    externalManager?: EntityManager,
  ): Promise<BookingHold> {
    const {
      bookingId,
      roomId,
      quantity,
      checkInAt,
      checkOutAt,
      holdMinutes = 15,
    } = params;

    if (quantity <= 0) {
      throw new BadRequestException('Số lượng phòng phải lớn hơn 0.');
    }
    if (checkOutAt <= checkInAt) {
      throw new BadRequestException(
        'Thời gian trả phòng phải sau thời gian nhận phòng.',
      );
    }

    const executeReserve = async (manager: EntityManager) => {
      // 1. SELECT room row FOR UPDATE to serialize operations on this room type
      const room = await manager.getRepository(Room).findOne({
        where: { id: roomId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!room) {
        throw new NotFoundException('Không tìm thấy loại phòng.');
      }
      if (room.status !== RoomStatus.AVAILABLE) {
        throw new ConflictException('Loại phòng này hiện không khả dụng để đặt.');
      }

      // 2. Query occupied rooms in interval [checkInAt, checkOutAt)
      const occupied = await this.getOccupiedRooms(
        roomId,
        checkInAt,
        checkOutAt,
        manager,
      );
      const available = room.totalRooms - occupied;

      if (available < quantity) {
        throw new ConflictException(
          'Loại phòng này vừa hết trong thời gian bạn chọn.',
        );
      }

      // 3. Create BookingHold
      const holdExpiresAt = new Date(Date.now() + holdMinutes * 60 * 1000);
      const holdRepo = manager.getRepository(BookingHold);
      const hold = holdRepo.create({
        bookingId,
        roomId,
        quantity,
        checkInAt,
        checkOutAt,
        status: BookingHoldStatus.HELD,
        holdExpiresAt,
      });

      return await holdRepo.save(hold);
    };

    // Use Redis lock for contention reduction if available, else run directly
    const lockKey = `inventory:room:${roomId}`;
    if (this.redisLockService) {
      return await this.redisLockService.withLock(lockKey, 5000, async () => {
        if (externalManager) {
          return await executeReserve(externalManager);
        }
        return await runWithDeadlockRetry(this.dataSource, executeReserve, {
          contextName: `InventoryReserve-${roomId}`,
        });
      });
    }

    if (externalManager) {
      return await executeReserve(externalManager);
    }
    return await runWithDeadlockRetry(this.dataSource, executeReserve, {
      contextName: `InventoryReserve-${roomId}`,
    });
  }

  /**
   * Commit hold khi payment thành công: HELD -> COMMITTED
   */
  async commitHold(
    bookingId: string,
    manager: EntityManager,
  ): Promise<BookingHold | null> {
    const holdRepo = manager.getRepository(BookingHold);
    const hold = await holdRepo.findOne({
      where: { bookingId, status: BookingHoldStatus.HELD },
    });

    if (!hold) {
      return null;
    }

    hold.status = BookingHoldStatus.COMMITTED;
    hold.committedAt = new Date();
    return await holdRepo.save(hold);
  }

  /**
   * Giải phóng hold: HELD -> RELEASED
   */
  async releaseHold(
    bookingId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<BookingHold | null> {
    const holdRepo = manager.getRepository(BookingHold);
    const hold = await holdRepo.findOne({
      where: { bookingId, status: BookingHoldStatus.HELD },
    });

    if (!hold) {
      return null;
    }

    hold.status = BookingHoldStatus.RELEASED;
    hold.releasedAt = new Date();
    hold.releaseReason = reason;
    return await holdRepo.save(hold);
  }

  /**
   * Thử re-acquire inventory trong tình huống Late IPN sau khi hold đã release (Section 33)
   * Tuyệt đối không overbook!
   */
  async reacquireInventory(
    bookingId: string,
    manager: EntityManager,
  ): Promise<{ success: boolean; hold?: BookingHold }> {
    const holdRepo = manager.getRepository(BookingHold);
    const hold = await holdRepo.findOne({
      where: { bookingId },
    });

    if (!hold) {
      return { success: false };
    }

    // Nếu đã COMMITTED rồi thì thành công
    if (hold.status === BookingHoldStatus.COMMITTED) {
      return { success: true, hold };
    }

    // Row lock room type
    const room = await manager.getRepository(Room).findOne({
      where: { id: hold.roomId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!room || room.status !== RoomStatus.AVAILABLE) {
      return { success: false };
    }

    const occupied = await this.getOccupiedRooms(
      hold.roomId,
      hold.checkInAt,
      hold.checkOutAt,
      manager,
    );
    const available = room.totalRooms - occupied;

    if (available >= hold.quantity) {
      // Còn phòng, có thể reacquire an toàn
      hold.status = BookingHoldStatus.COMMITTED;
      hold.committedAt = new Date();
      hold.releaseReason = 'REACQUIRED_ON_LATE_IPN';
      const saved = await holdRepo.save(hold);
      return { success: true, hold: saved };
    }

    // Hết phòng: Không overbook!
    return { success: false };
  }
}
