import * as mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function seed() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'hotel_booking_db',
  });

  console.log('Connected to MySQL database:', process.env.DB_DATABASE);

  // 1. Seed Hotel Types (chỉ 1 loại Khách sạn trước mắt)
  await connection.query(`
    INSERT INTO hotel_types (id, code, name, description, status)
    VALUES
      (1, 'HOTEL', 'Khách sạn', 'Cơ sở lưu trú dạng khách sạn', 'ACTIVE')
    ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status);
  `);
  console.log('Seeded hotel_types successfully.');

  // 2. Seed Locations
  await connection.query(`
    INSERT INTO locations (id, code, name, type, status)
    VALUES
      (1, 'HCM', 'TP. Hồ Chí Minh', 'CITY', 'ACTIVE'),
      (2, 'HN', 'Hà Nội', 'CITY', 'ACTIVE'),
      (3, 'DN', 'Đà Nẵng', 'CITY', 'ACTIVE')
    ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status);
  `);
  console.log('Seeded locations successfully.');

  // 3. Create table rooms if not exists
  await connection.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      hotel_id            BIGINT UNSIGNED NOT NULL,
      name                VARCHAR(150) NOT NULL,
      slug                VARCHAR(180) NOT NULL,
      description         TEXT NULL,
      price_per_night     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      
      check_in_time       TIME NOT NULL DEFAULT '14:00:00',
      check_out_time      TIME NOT NULL DEFAULT '12:00:00',
      
      max_adults          TINYINT UNSIGNED NOT NULL DEFAULT 2,
      max_children        TINYINT UNSIGNED NOT NULL DEFAULT 0,
      
      total_rooms         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      available_rooms     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      
      bed_count           TINYINT UNSIGNED NOT NULL DEFAULT 1,
      bed_type            VARCHAR(100) NOT NULL DEFAULT 'Giường Đôi',
      room_size           SMALLINT UNSIGNED NULL,
      
      rating              DECIMAL(3,2) NOT NULL DEFAULT 5.00,
      review_count        INT UNSIGNED NOT NULL DEFAULT 0,
      
      cover_image_url     VARCHAR(500) NULL,
      status              VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
      
      created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at          DATETIME NULL,
      
      CONSTRAINT pk_rooms PRIMARY KEY (id),
      CONSTRAINT uq_rooms_hotel_slug UNIQUE (hotel_id, slug),
      CONSTRAINT fk_rooms_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT chk_rooms_bed_count CHECK (bed_count BETWEEN 1 AND 2),
      CONSTRAINT chk_rooms_status CHECK (status IN ('AVAILABLE', 'UNAVAILABLE', 'MAINTENANCE')),
      CONSTRAINT chk_rooms_price CHECK (price_per_night >= 0),
      CONSTRAINT chk_rooms_adults CHECK (max_adults >= 1),
      CONSTRAINT chk_rooms_total_rooms CHECK (total_rooms >= 1),
      
      INDEX idx_rooms_hotel_id (hotel_id),
      INDEX idx_rooms_status (status),
      INDEX idx_rooms_price (price_per_night)
    ) ENGINE=InnoDB;
  `);
  console.log('Created or verified rooms table successfully.');

  // 4. Create table hotel_images if not exists
  await connection.query(`
    CREATE TABLE IF NOT EXISTS hotel_images (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      hotel_id    BIGINT UNSIGNED NOT NULL,
      image_url   VARCHAR(500) NOT NULL,
      caption     VARCHAR(200) NULL,
      sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      is_primary  TINYINT(1) NOT NULL DEFAULT 0,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT pk_hotel_images PRIMARY KEY (id),
      CONSTRAINT fk_hotel_images_hotel FOREIGN KEY (hotel_id) 
          REFERENCES hotels(id) ON UPDATE CASCADE ON DELETE CASCADE,
      INDEX idx_hotel_images_hotel_id (hotel_id),
      INDEX idx_hotel_images_sort (hotel_id, sort_order)
    ) ENGINE=InnoDB;
  `);
  console.log('Created or verified hotel_images table successfully.');

  // 5. Create table room_images if not exists
  await connection.query(`
    CREATE TABLE IF NOT EXISTS room_images (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      room_id     BIGINT UNSIGNED NOT NULL,
      image_url   VARCHAR(500) NOT NULL,
      caption     VARCHAR(200) NULL,
      sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      is_primary  TINYINT(1) NOT NULL DEFAULT 0,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT pk_room_images PRIMARY KEY (id),
      CONSTRAINT fk_room_images_room FOREIGN KEY (room_id) 
          REFERENCES rooms(id) ON UPDATE CASCADE ON DELETE CASCADE,
      INDEX idx_room_images_room_id (room_id),
      INDEX idx_room_images_sort (room_id, sort_order)
    ) ENGINE=InnoDB;
  `);
  console.log('Created or verified room_images table successfully.');

  // 6. Seed Admin & Employee accounts
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('123456789', 12);

  await connection.query(`
    INSERT INTO users (full_name, email, password, role, status, email_verified_at)
    VALUES ('Quản Trị Viên', 'admintraveloka@gmail.com', ?, 'ADMIN', 'ACTIVE', NOW())
    ON DUPLICATE KEY UPDATE
      password = VALUES(password),
      role = 'ADMIN',
      status = 'ACTIVE',
      email_verified_at = NOW();
  `, [passwordHash]);

  await connection.query(`
    INSERT IGNORE INTO users_roles (user_id, role_id)
    SELECT u.id, r.id FROM users u, roles r
    WHERE u.email = 'admintraveloka@gmail.com' AND r.name = 'ADMIN';
  `);

  await connection.query(`
    INSERT INTO users (full_name, email, password, role, status, email_verified_at)
    VALUES ('Nhân Viên', 'nhanvientraveloka@gmail.com', ?, 'EMPLOYEE', 'ACTIVE', NOW())
    ON DUPLICATE KEY UPDATE
      password = VALUES(password),
      role = 'EMPLOYEE',
      status = 'ACTIVE',
      email_verified_at = NOW();
  `, [passwordHash]);

  await connection.query(`
    INSERT IGNORE INTO users_roles (user_id, role_id)
    SELECT u.id, r.id FROM users u, roles r
    WHERE u.email = 'nhanvientraveloka@gmail.com' AND r.name = 'EMPLOYEE';
  `);
  // 7. Seed Sample Hotels & Rooms if empty
  const [hotelsCountRows]: any = await connection.query(`SELECT COUNT(*) as cnt FROM hotels`);
  if (hotelsCountRows[0].cnt === 0) {
    console.log('Seeding sample hotels and rooms...');
    await connection.query(`
      INSERT INTO hotels (id, hotel_type_id, location_id, name, slug, description, star_rating, address, phone, email, cover_image_url, status)
      VALUES
        (1, 1, 1, 'Khách sạn Caravelle Sài Gòn', 'khach-san-caravelle-sai-gon', 'Khách sạn 5 sao sang trọng ngay trung tâm Quận 1 với tầm nhìn tráng lệ ra toàn cảnh thành phố.', 5, '19-23 Công Trường Lam Sơn, Bến Nghé, Quận 1, TP. Hồ Chí Minh', '02838234999', 'caravelle@traveleke.vn', '/uploads/hotels/hotels-1786794920215-472320896.png', 'ACTIVE'),
        (2, 1, 3, 'Furama Resort Đà Nẵng', 'furama-resort-da-nang', 'Khu nghỉ dưỡng 5 sao hướng biển Bắc Mỹ An tuyệt đẹp với hệ sinh thái ẩm thực và hồ bơi vô cực đẳng cấp.', 5, '105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng', '02363847333', 'furama@traveleke.vn', '/uploads/hotels/hotels-1786798592187-334845302.png', 'ACTIVE'),
        (3, 1, 2, 'Lotte Hotel Hà Nội', 'lotte-hotel-ha-noi', 'Tọa lạc trên các tầng cao của tòa nhà Lotte Center, mang đến trải nghiệm nghỉ dưỡng 5 sao trên tầng mây.', 5, '54 Liễu Giai, Ba Đình, Hà Nội', '02433331000', 'lotte@traveleke.vn', '/uploads/hotels/hotels-1788620536254-73388191.png', 'ACTIVE')
      ON DUPLICATE KEY UPDATE name = VALUES(name);
    `);

    await connection.query(`
      INSERT INTO hotel_images (hotel_id, image_url, caption, sort_order, is_primary)
      VALUES
        (1, '/uploads/hotels/hotels-1786794920215-472320896.png', 'Mặt tiền khách sạn Caravelle', 0, 1),
        (1, '/uploads/hotels/hotels-1786795692411-620859.png', 'Sảnh chính Caravelle', 1, 0),
        (2, '/uploads/hotels/hotels-1786798592187-334845302.png', 'Khuôn viên Furama Resort', 0, 1),
        (2, '/uploads/hotels/hotels-1786798592184-324501.jpg', 'Hồ bơi hướng biển Furama', 1, 0),
        (3, '/uploads/hotels/hotels-1788620536254-73388191.png', 'Toàn cảnh Lotte Hotel Hà Nội', 0, 1)
      ON DUPLICATE KEY UPDATE caption = VALUES(caption);
    `);

    await connection.query(`
      INSERT INTO rooms (id, hotel_id, name, slug, description, price_per_night, max_adults, max_children, total_rooms, available_rooms, bed_count, bed_type, room_size, rating, review_count, cover_image_url, status)
      VALUES
        (1, 1, 'Phòng Deluxe City View', 'phong-deluxe-city-view-caravelle', 'Phòng nghỉ tiện nghi hiện đại với cửa kính panorama view ngắm trung tâm thành phố Sài Gòn rực rỡ ánh đèn.', 1850000, 2, 1, 10, 8, 1, 'Giường Đôi', 38, 4.90, 48, '/uploads/rooms/rooms-1786797511481-837351127.png', 'AVAILABLE'),
        (2, 1, 'Phòng Premium Suite King', 'phong-premium-suite-king-caravelle', 'Suite cao cấp với phòng khách riêng biệt, bồn tắm nằm massage và đặc quyền sử dụng Signature Lounge.', 3200000, 2, 2, 5, 4, 1, 'Giường Đôi King', 56, 5.00, 32, '/uploads/rooms/rooms-1786797511488-924455364.png', 'AVAILABLE'),
        (3, 2, 'Phòng Ocean Deluxe Biển Mỹ An', 'phong-ocean-deluxe-bien-my-an', 'Phòng hướng biển với ban công thoáng mát, đón gió biển tự nhiên trong lành và không gian thư giãn tuyệt đối.', 2450000, 2, 1, 12, 10, 1, 'Giường Đôi', 45, 4.95, 75, '/uploads/rooms/rooms-1786798401064-252341834.jpg', 'AVAILABLE'),
        (4, 2, 'Biệt Thự Hướng Vườn Furama Villa', 'biet-thu-huong-vuon-furama-villa', 'Villa sân vườn nhiệt đới với hồ bơi riêng biệt, không gian nghỉ dưỡng biệt lập lý tưởng cho gia đình.', 5900000, 4, 2, 4, 3, 2, '2 Giường Đôi King', 120, 5.00, 26, '/uploads/rooms/rooms-1786803009948-438879937.png', 'AVAILABLE'),
        (5, 3, 'Phòng Grand Deluxe Lotte', 'phong-grand-deluxe-lotte', 'Thiết kế phong cách tối giản thanh lịch với view hồ Tây thơ mộng từ trên cao cùng giường nệm êm ái.', 2100000, 2, 1, 15, 12, 1, 'Giường Đôi', 42, 4.88, 54, '/uploads/rooms/rooms-1788621367940-828756673.png', 'AVAILABLE'),
        (6, 3, 'Phòng Club Junior Suite', 'phong-club-junior-suite-lotte', 'Không gian sang trọng với bàn làm việc cao cấp, bồn tắm ngắm mây và bữa sáng buffet thượng hạng miễn phí.', 3800000, 2, 1, 6, 5, 1, 'Giường Đôi King', 65, 4.96, 41, '/uploads/rooms/rooms-1788621480468-810683228.png', 'AVAILABLE')
      ON DUPLICATE KEY UPDATE name = VALUES(name);
    `);

    await connection.query(`
      INSERT INTO room_images (room_id, image_url, caption, sort_order, is_primary)
      VALUES
        (1, '/uploads/rooms/rooms-1786797511481-837351127.png', 'Ảnh phòng Deluxe City View', 0, 1),
        (2, '/uploads/rooms/rooms-1786797511488-924455364.png', 'Ảnh phòng Premium Suite King', 0, 1),
        (3, '/uploads/rooms/rooms-1786798401064-252341834.jpg', 'Ảnh phòng Ocean Deluxe', 0, 1),
        (4, '/uploads/rooms/rooms-1786803009948-438879937.png', 'Ảnh Biệt Thự Hướng Vườn', 0, 1),
        (5, '/uploads/rooms/rooms-1788621367940-828756673.png', 'Ảnh phòng Grand Deluxe Lotte', 0, 1),
        (6, '/uploads/rooms/rooms-1788621480468-810683228.png', 'Ảnh phòng Club Junior Suite', 0, 1)
      ON DUPLICATE KEY UPDATE caption = VALUES(caption);
    `);
    console.log('Seeded sample hotels, rooms, and images successfully.');
  }

  await connection.end();
  console.log('Database seeding completed successfully!');
}

seed().catch((err: unknown) => {
  console.error('Seeding error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
