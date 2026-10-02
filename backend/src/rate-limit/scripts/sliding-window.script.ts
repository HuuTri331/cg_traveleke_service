/**
 * Redis Lua Script cho Tầng 1: Sliding Window Log (Rate limiting theo IP).
 *
 * Lưu trữ timestamp từng request vào Redis Sorted Set (ZSET).
 * Đảm bảo tính nguyên tử (atomic) và giải quyết triệt để Race Condition.
 *
 * KEYS[1]: Redis Key (ví dụ: rl:ip:127.0.0.1:auth:login)
 * ARGV[1]: now (mili-giây hiện tại)
 * ARGV[2]: windowMs (kích thước cửa sổ trượt mili-giây, vd: 60000)
 * ARGV[3]: limit (số request tối đa trong cửa sổ)
 * ARGV[4]: requestId (UUID hoặc timestamp-randomId độc nhất)
 *
 * Return: [allowed (0 hoặc 1), currentCount]
 */
export const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]

local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local requestId = ARGV[4]

local windowStart = now - windowMs

-- 1. Xóa các request nằm ngoài cửa sổ trượt (cũ hơn windowStart)
redis.call(
  'ZREMRANGEBYSCORE',
  key,
  '-inf',
  windowStart
)

-- 2. Đếm số request hiện có trong cửa sổ
local currentCount = redis.call(
  'ZCARD',
  key
)

-- 3. Kiểm tra hạn mức
if currentCount >= limit then
  redis.call('PEXPIRE', key, windowMs)
  return { 0, currentCount }
end

-- 4. Ghi nhận request hợp lệ vào Sorted Set
redis.call(
  'ZADD',
  key,
  now,
  requestId
)

-- 5. Cập nhật thời gian sống của key theo kích thước cửa sổ
redis.call(
  'PEXPIRE',
  key,
  windowMs
)

return { 1, currentCount + 1 }
`;
