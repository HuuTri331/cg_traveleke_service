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

  await connection.end();
  console.log('Database seeding completed successfully!');
}

seed().catch((err: unknown) => {
  console.error('Seeding error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
