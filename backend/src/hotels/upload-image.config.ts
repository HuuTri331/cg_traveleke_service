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

export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${subDir}-${uniqueSuffix}${ext}`);
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
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(
          new BadRequestException(
            'Chỉ chấp nhận các file ảnh có định dạng JPG, PNG, WEBP, AVIF. Vui lòng kiểm tra lại file đã chọn.',
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
