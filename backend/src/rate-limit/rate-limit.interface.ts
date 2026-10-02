export interface TokenBucketOptions {
  /**
   * Dung lượng tối đa của bucket (số token tối đa)
   */
  capacity: number;

  /**
   * Tốc độ hồi phục token (số token sinh ra trên mỗi giây)
   */
  refillRate: number;

  /**
   * Số lượng token tiêu thụ cho mỗi request (mặc định là 1)
   */
  cost?: number;
}

export interface SlidingWindowOptions {
  /**
   * Số lượng request tối đa được phép trong cửa sổ thời gian
   */
  limit: number;

  /**
   * Kích thước cửa sổ trượt tính bằng mili-giây (ví dụ: 60000 = 60s)
   */
  windowMs: number;
}

export interface RateLimitOptions {
  /**
   * Tầng 2: Token Bucket Rate Limiting (thường áp dụng cho Authenticated User)
   */
  tokenBucket?: TokenBucketOptions;

  /**
   * Tầng 1: Sliding Window Log Rate Limiting (thường áp dụng theo IP)
   */
  slidingWindow?: SlidingWindowOptions;
}
