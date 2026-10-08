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
   * Overlap condition chuẩn:
   * existing.checkInAt < requested.checkOutAt AND existing.checkOutAt > requested.checkInAt
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
   * Tạo bản ghi giữ chỗ ban đầu (duy nhất 1 row cho 1 booking)
   * Sử dụng Redis Lock + MySQL Pessimistic Row Lock (SELECT FOR UPDATE)
   */
  async createInitialHold(
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

      // 3. Create single BookingHold
      const holdExpiresAt = new Date(Date.now() + holdMinutes * 60 * 1000);
      const holdRepo = manager.getRepository(BookingHold);

      // Check existing row if any to respect unique constraint
      let hold = await holdRepo.findOne({
        where: { bookingId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!hold) {
        hold = holdRepo.create({
          bookingId,
          roomId,
          quantity,
          checkInAt,
          checkOutAt,
          status: BookingHoldStatus.HELD,
          holdExpiresAt,
        });
      } else {
        hold.roomId = roomId;
        hold.quantity = quantity;
        hold.checkInAt = checkInAt;
        hold.checkOutAt = checkOutAt;
        hold.status = BookingHoldStatus.HELD;
        hold.holdExpiresAt = holdExpiresAt;
        hold.releasedAt = null;
        hold.releaseReason = null;
        hold.committedAt = null;
      }

      return await holdRepo.save(hold);
    };

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
   * Giữ chỗ tương thích (reserveHold delegates to createInitialHold)
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
    return this.createInitialHold(params, externalManager);
  }

  /**
   * Khóa và lấy bản ghi hold với pessimistic_write
   */
  async getHoldForUpdate(
    bookingId: string,
    manager: EntityManager,
  ): Promise<BookingHold | null> {
    const repo = manager.getRepository(BookingHold);
    return await repo.findOne({
      where: { bookingId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Tái sử dụng hoặc reacquire lại hold khi người dùng bấm thanh toán lại (Retry)
   * Tuyệt đối KHÔNG INSERT row mới để đảm bảo 1 booking chỉ có 1 hold row duy nhất.
   */
  async reuseOrReacquireHold(
    bookingId: string,
    manager: EntityManager,
  ): Promise<BookingHold> {
    const repo = manager.getRepository(BookingHold);

    const hold = await repo.findOne({
      where: { bookingId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!hold) {
      throw new NotFoundException('Không tìm thấy thông tin giữ phòng cho đơn này.');
    }

    const now = new Date();

    // 1. Đang HELD và còn hạn -> Tái sử dụng hold hiện tại
    if (hold.status === BookingHoldStatus.HELD && hold.holdExpiresAt > now) {
      return hold;
    }

    // 2. Đã COMMITTED -> Đơn đã thanh toán, không cho retry
    if (hold.status === BookingHoldStatus.COMMITTED) {
      return hold;
    }

    // 3. RELEASED hoặc EXPIRED -> Kiểm tra số phòng trống và reacquire trên CÙNG 1 ROW
    const room = await manager.getRepository(Room).findOne({
      where: { id: hold.roomId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!room || room.status !== RoomStatus.AVAILABLE) {
      throw new ConflictException('Loại phòng này hiện không khả dụng để đặt.');
    }

    const occupied = await this.getOccupiedRooms(
      hold.roomId,
      hold.checkInAt,
      hold.checkOutAt,
      manager,
    );

    if (room.totalRooms - occupied < hold.quantity) {
      throw new ConflictException(
        'Loại phòng này vừa hết trong thời gian bạn chọn.',
      );
    }

    hold.status = BookingHoldStatus.HELD;
    hold.holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    hold.releasedAt = null;
    hold.releaseReason = null;
    hold.committedAt = null;

    return await repo.save(hold);
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
      lock: { mode: 'pessimistic_write' },
    });

    if (!hold) {
      return null;
    }

    hold.status = BookingHoldStatus.COMMITTED;
    hold.committedAt = new Date();
    return await holdRepo.save(hold);
  }

  /**
   * Giải phóng hold: HELD -> RELEASED (hết hạn / timeout)
   */
  async releaseHold(
    bookingId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<BookingHold | null> {
    const holdRepo = manager.getRepository(BookingHold);
    const hold = await holdRepo.findOne({
      where: { bookingId, status: BookingHoldStatus.HELD },
      lock: { mode: 'pessimistic_write' },
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
   * Giải phóng hold đã COMMITTED khi đơn đặt phòng được Hủy hợp lệ (Cancellation Approved)
   * COMMITTED -> RELEASED
   */
  async releaseCommittedHold(
    bookingId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<BookingHold | null> {
    const holdRepo = manager.getRepository(BookingHold);
    const hold = await holdRepo.findOne({
      where: { bookingId, status: BookingHoldStatus.COMMITTED },
      lock: { mode: 'pessimistic_write' },
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
   * Thử re-acquire inventory trong tình huống Late IPN sau khi hold đã release
   * Tuyệt đối không overbook!
   */
  async reacquireInventory(
    bookingId: string,
    manager: EntityManager,
  ): Promise<{ success: boolean; hold?: BookingHold }> {
    const holdRepo = manager.getRepository(BookingHold);
    const hold = await holdRepo.findOne({
      where: { bookingId },
      lock: { mode: 'pessimistic_write' },
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
