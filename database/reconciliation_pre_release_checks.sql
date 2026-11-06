-- =============================================================================
-- TRAVELEKE: READ-ONLY PRE-RELEASE RECONCILIATION SQL (SECTION 10.3)
-- Chạy đối soát chỉ đọc (READ-ONLY) trước khi bật feature flag cho khách sạn.
-- =============================================================================

-- 1. Booking đã PAID có booking hold COMMITTED nhưng chưa có người phụ trách (handled_by IS NULL)
SELECT DISTINCT b.id, b.booking_code, b.hotel_id, b.handled_by
FROM bookings b
JOIN payment_transactions p ON p.booking_id = b.id AND p.status = 'PAID'
JOIN booking_holds h ON h.booking_id = b.id AND h.status = 'COMMITTED'
WHERE b.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
  AND b.handled_by IS NULL;

-- 2. Các booking PAID chưa có folio; chỉ chạy sau khi migration folios tạo xong
SELECT DISTINCT b.id, b.booking_code
FROM bookings b
JOIN payment_transactions p ON p.booking_id = b.id AND p.status = 'PAID'
LEFT JOIN folios f ON f.booking_id = b.id
WHERE f.id IS NULL;

-- 3. Các allocation trùng UNIT x DATE về mặt logical; unique index uq_active_unit_per_night ngăn điều này
SELECT active_unit_key, stay_date, COUNT(*) AS n
FROM room_unit_stay_slots
WHERE released_at IS NULL
GROUP BY active_unit_key, stay_date
HAVING COUNT(*) > 1;

-- 4. Đối soát tồn kho vật lý vs tồn kho thương mại: KHÔNG tự set verified khi số unit không khớp catalog
SELECT r.hotel_id,
       r.id AS room_type_id,
       r.name,
       r.total_rooms AS commercial_count,
       COUNT(u.id) AS declared_physical_units
FROM rooms r
LEFT JOIN room_units u
  ON u.room_type_id = r.id AND u.hotel_id = r.hotel_id
WHERE r.deleted_at IS NULL
GROUP BY r.hotel_id, r.id, r.name, r.total_rooms
HAVING COUNT(u.id) <> r.total_rooms;
