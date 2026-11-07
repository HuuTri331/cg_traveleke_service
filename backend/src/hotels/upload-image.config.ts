import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import { diskStorage } from 'multer';
import * as path from 'path';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'image/avif',
];

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * E10 (MEDIUM-08): Kiểm tra chữ ký byte thực tế (magic bytes) của file ảnh (JPEG, PNG, WEBP, AVIF)
 * chống giả mạo Content-Type / đuôi file.
 */
export function verifyImageMagicBytes(input: Buffer | string): boolean {
  const buf =
    typeof input === 'string'
      ? fs.existsSync(input)
        ? fs.readFileSync(input).subarray(0, 32)
        : Buffer.alloc(0)
      : input.subarray(0, 32);

  if (buf.length < 4) return false;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return true;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return true;
  }

  // AVIF: ISO Base Media File Format "ftypavif" or "ftypavis"
  if (
    buf.length >= 12 &&
    buf.subarray(4, 8).toString('ascii') === 'ftyp' &&
    ['avif', 'avis', 'mif1'].includes(buf.subarray(8, 12).toString('ascii'))
  ) {
    return true;
  }

  return false;
}

export function assertValidImageMagicBytes(input: Buffer | string): void {
  if (!verifyImageMagicBytes(input)) {
    if (typeof input === 'string' && fs.existsSync(input)) {
      try {
        fs.unlinkSync(input);
      } catch {
        // ignore cleanup error
      }
    }
    throw new BadRequestException(
      'INVALID_IMAGE_MAGIC_BYTES: Nội dung nhị phân của tệp không phải là định dạng ảnh hợp lệ (JPEG/PNG/WEBP/AVIF).',
    );
  }
}

export function createMulterOptions(subDir: 'hotels' | 'rooms') {
  const uploadDir = path.join(process.cwd(), 'uploads', subDir);

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : '.jpg';
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${subDir}-${uniqueSuffix}${safeExt}`);
      },
    }),
    limits: {
      fileSize: MAX_IMAGE_FILE_SIZE,
    },
    fileFilter: (
      _req: any,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
        return cb(
          new BadRequestException(
            'Chỉ chấp nhận các file ảnh có định dạng và phần mở rộng hợp lệ (.jpg, .jpeg, .png, .webp, .avif).',
          ),
          false,
        );
      }
      cb(null, true);
    },
  };
}

export function deletePhysicalFile(imageUrl?: string | null): void {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) {
    return;
  }

  const normalizedPath = imageUrl.startsWith('/')
    ? imageUrl.slice(1)
    : imageUrl;
  const absolutePath = path.join(process.cwd(), normalizedPath);

  try {
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (err: unknown) {
    console.warn(
      `[Storage] Không thể xóa file: ${absolutePath}`,
      err instanceof Error ? err.message : err,
    );
  }
}
