/**
 * Redis Lua Script cho Tầng 2: Token Bucket (Rate limiting theo User / API Key).
 * 
 * Lưu trữ trạng thái trong Redis Hash ('available', 'updatedAt').
 * Cho phép burst traffic tự nhiên và tự động refill token theo thời gian.
 * 
 * KEYS[1]: Redis Key (ví dụ: rl:user:12:bookings:create)
 * ARGV[1]: capacity (dung lượng tối đa)
 * ARGV[2]: refillRate (số token sinh thêm mỗi giây)
 * ARGV[3]: currentTime (timestamp giây dạng float hoặc integer)
 * ARGV[4]: requestCost (số token tiêu hao cho request)
 * 
 * Return: [allowed (0 hoặc 1), remainingTokens]
 */
export const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]

local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local currentTime = tonumber(ARGV[3])
local requestCost = tonumber(ARGV[4])

local data = redis.call(
  'HMGET',
  key,
  'available',
  'updatedAt'
)

local available = tonumber(data[1])
local updatedAt = tonumber(data[2])

-- Khởi tạo bucket ban đầu nếu chưa tồn tại
if available == nil then
  available = capacity
  updatedAt = currentTime
end

-- Tính toán lượng token tự động hồi phục theo thời gian trôi qua
local elapsed = currentTime - updatedAt

if elapsed > 0 then
  local generated = elapsed * refillRate
  available = math.min(
    capacity,
    available + generated
  )
  updatedAt = currentTime
end

local allowed = 0

-- Tiêu thụ token nếu đủ dung lượng
if available >= requestCost then
  available = available - requestCost
  allowed = 1
end

-- Cập nhật lại hash trong Redis
redis.call(
  'HSET',
  key,
  'available',
  available,
  'updatedAt',
  updatedAt
)

-- TTL bằng thời gian cần để hồi đầy bucket từ 0 token
local ttl = math.ceil(capacity / refillRate)
if ttl < 1 then
  ttl = 1
end

redis.call('EXPIRE', key, ttl)

return {
  allowed,
  math.floor(available)
}
`;
