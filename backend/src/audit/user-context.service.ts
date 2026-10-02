import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface UserContextStore {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class UserContextService {
  private readonly asyncLocalStorage =
    new AsyncLocalStorage<UserContextStore>();

  /**
   * Bọc một hàm callback trong phạm vi AsyncLocalStorage context.
   */
  public run<T>(store: UserContextStore, callback: () => T): T {
    return this.asyncLocalStorage.run(store, callback);
  }

  /**
   * Lấy toàn bộ context hiện tại của Request.
   */
  public getStore(): UserContextStore | undefined {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * Lấy User ID đang thực hiện request.
   */
  public getUserId(): string | undefined {
    return this.asyncLocalStorage.getStore()?.userId;
  }

  /**
   * Cập nhật User ID vào context khi đã xác thực xong (ví dụ sau JwtAuthGuard).
   */
  public setUserId(userId: string): void {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      store.userId = userId;
    }
  }

  /**
   * Cập nhật thêm thông tin vào store hiện tại.
   */
  public updateStore(partial: Partial<UserContextStore>): void {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      Object.assign(store, partial);
    }
  }
}
