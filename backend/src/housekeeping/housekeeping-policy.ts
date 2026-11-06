import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  RoomUnit,
  RoomUnitHousekeepingState,
  RoomUnitOperationalStatus,
} from '../room-units/entities/room-unit.entity';
import { HousekeepingTask } from './entities/housekeeping-task.entity';

/**
 * Enforces 4-eyes inspection rule: the person who cleaned the room cannot self-approve
 * the inspection to transition the room to READY.
 */
export function assertFourEyesInspection(
  task: Pick<HousekeepingTask, 'cleanedBy' | 'assignedTo'>,
  inspectorActor: { id: string; role: string },
): void {
  const cleanerId = task.cleanedBy || task.assignedTo;
  if (cleanerId && String(cleanerId) === String(inspectorActor.id)) {
    throw new ForbiddenException(
      'FOUR_EYES_INSPECTION_REQUIRED: Nhân viên dọn phòng không được tự nghiệm thu (inspect) phòng do chính mình vừa dọn.',
    );
  }
}

/**
 * Determines the resulting housekeeping state of a physical room unit after inspection.
 * If the room unit is OUT_OF_ORDER (maintenance block), inspection cannot make it READY for check-in.
 */
export function resolveUnitStateAfterInspection(
  unit: Pick<RoomUnit, 'operationalStatus' | 'roomNumber'>,
  approved: boolean,
): RoomUnitHousekeepingState {
  if (!approved) {
    return RoomUnitHousekeepingState.DIRTY;
  }
  if (unit.operationalStatus === RoomUnitOperationalStatus.OUT_OF_ORDER) {
    throw new ConflictException(
      `UNIT_OUT_OF_ORDER: Phòng #${unit.roomNumber} đang khóa bảo trì (OUT_OF_ORDER), chưa thể chuyển sang READY để nhận khách.`,
    );
  }
  return RoomUnitHousekeepingState.READY;
}
