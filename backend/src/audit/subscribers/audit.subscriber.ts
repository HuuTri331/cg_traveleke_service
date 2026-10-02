import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
  DataSource,
} from 'typeorm';
import { Injectable } from '@nestjs/common';
import { AuditLogEntity, AuditAction } from '../entities/audit-log.entity';
import { UserContextService } from '../user-context.service';
import { logWithTrace } from '../../observability/trace-logger';

const SENSITIVE_FIELDS = new Set([
  'password',
  'token',
  'refreshtoken',
  'secret',
  'jwt',
  'cardnumber',
  'cvv',
]);

@Injectable()
@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface {
  constructor(
    private readonly dataSource: DataSource,
    private readonly userContextService: UserContextService,
  ) {
    // Đăng ký subscriber vào DataSource của TypeORM
    this.dataSource.subscribers.push(this);
  }

  /**
   * Chốt chặn loại trừ AuditLogEntity để ngăn chặn hiện tượng vòng lặp vô hạn (Infinite Loop).
   */
  private isIgnoredEntity(entityName: string): boolean {
    return (
      entityName === AuditLogEntity.name ||
      entityName === 'AuditLogEntity' ||
      entityName === 'audit_logs'
    );
  }

  /**
   * Che giấu các dữ liệu nhạy cảm (như mật khẩu, token bí mật).
   */
  private sanitizeValue(key: string, value: any): any {
    if (value === null || value === undefined) return value;
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      return '[REDACTED]';
    }
    if (typeof value === 'object' && !(value instanceof Date)) {
      if (Array.isArray(value)) {
        return value.map((item, idx) => this.sanitizeValue(String(idx), item));
      }
      const sanitizedObj: Record<string, any> = {};
      for (const k of Object.keys(value)) {
        sanitizedObj[k] = this.sanitizeValue(k, value[k]);
      }
      return sanitizedObj;
    }
    return value;
  }

  /**
   * Lọc và làm sạch object dữ liệu trước khi lưu vào audit log.
   */
  private sanitizeData(
    data: Record<string, any> | null,
  ): Record<string, any> | null {
    if (!data) return null;
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      clean[key] = this.sanitizeValue(key, value);
    }
    return clean;
  }

  /**
   * Sự kiện sau khi tạo mới bản ghi (INSERT).
   */
  public async afterInsert(event: InsertEvent<any>): Promise<void> {
    if (!event.entity || this.isIgnoredEntity(event.metadata.name)) return;
    const sanitizedEntity = this.sanitizeData(event.entity);
    await this.saveLog(event, AuditAction.INSERT, null, sanitizedEntity);
  }

  /**
   * Sự kiện sau khi cập nhật bản ghi (UPDATE) - Áp dụng Diffing thông minh.
   */
  public async afterUpdate(event: UpdateEvent<any>): Promise<void> {
    if (!event.entity || this.isIgnoredEntity(event.metadata.name)) return;

    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    if (event.databaseEntity && event.entity) {
      for (const column of event.metadata.columns) {
        const propertyName = column.propertyName;

        // Bỏ qua các cột tự động cập nhật thời gian
        if (propertyName === 'updatedAt' || propertyName === 'updated_at') {
          continue;
        }

        const oldValue = event.databaseEntity[propertyName];
        const newValue = event.entity[propertyName];

        // So sánh Diffing: Chỉ lưu những trường có giá trị thực sự thay đổi
        if (
          newValue !== undefined &&
          JSON.stringify(oldValue) !== JSON.stringify(newValue)
        ) {
          oldValues[propertyName] = this.sanitizeValue(propertyName, oldValue);
          newValues[propertyName] = this.sanitizeValue(propertyName, newValue);
        }
      }
    }

    // Chỉ ghi log nếu có ít nhất 1 trường dữ liệu thay đổi
    if (Object.keys(newValues).length > 0) {
      await this.saveLog(event, AuditAction.UPDATE, oldValues, newValues);
    }
  }

  /**
   * Sự kiện sau khi xóa bản ghi (DELETE).
   */
  public async afterRemove(event: RemoveEvent<any>): Promise<void> {
    if (this.isIgnoredEntity(event.metadata.name)) return;
    const oldValues = event.databaseEntity || event.entity;
    const sanitizedOld = this.sanitizeData(oldValues);
    await this.saveLog(event, AuditAction.DELETE, sanitizedOld, null);
  }

  /**
   * Lưu bản ghi Audit Log sử dụng Transaction Manager hiện tại của TypeORM.
   */
  private async saveLog(
    event: InsertEvent<any> | UpdateEvent<any> | RemoveEvent<any>,
    action: AuditAction,
    oldValues: Record<string, any> | null,
    newValues: Record<string, any> | null,
  ): Promise<void> {
    try {
      const context = this.userContextService.getStore();
      const databaseEntity =
        'databaseEntity' in event ? (event as any).databaseEntity : null;
      const entityId = event.entity?.id || databaseEntity?.id || 'UNKNOWN';

      const tableName = event.metadata.tableName || event.metadata.name;

      const auditLog = event.manager.create(AuditLogEntity, {
        entityName: tableName,
        entityId: String(entityId),
        action,
        oldValues,
        newValues,
        performedBy: context?.userId || 'SYSTEM',
        ipAddress: context?.ipAddress || null,
        userAgent: context?.userAgent
          ? context.userAgent.substring(0, 255)
          : null,
        requestId: context?.requestId || null,
      });

      // Lưu cùng Transaction Manager để đảm bảo tính nhất quán (ACID)
      await event.manager.getRepository(AuditLogEntity).save(auditLog);
    } catch (error: any) {
      // Log lỗi nhưng không làm ngắt quãng luồng nghiệp vụ chính của người dùng
      logWithTrace('error', '[AuditSubscriber] Lỗi khi lưu Audit Log', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
