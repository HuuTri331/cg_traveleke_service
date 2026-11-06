import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

export interface HotelListingVersionRecord {
  hotelId: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  checkinPolicy: string;
  childPolicy: string;
  petPolicy: string;
  smokingPolicy: string;
  cancellationSummary: string;
  amenities: string[];
  breakfastIncludedInBaseRoom: boolean;
  publishedAt: Date | null;
  policyHash: string;
}

@Injectable()
export class HotelContentService {
  private readonly publishedByHotel = new Map<string, HotelListingVersionRecord>();
  private readonly bookingPolicySnapshots = new Map<string, HotelListingVersionRecord>();

  /**
   * Publishes a validated hotel listing version (IMP-31 / GAP-31).
   * Blocks publishing if required policies are missing or if breakfast disclosure contradicts package rules.
   */
  publishListingVersion(params: {
    hotelId: string;
    checkinPolicy: string;
    childPolicy: string;
    petPolicy?: string;
    smokingPolicy?: string;
    cancellationSummary: string;
    amenities: string[];
    breakfastIncludedInBaseRoom: boolean;
    paidBreakfastServiceExists?: boolean;
  }): HotelListingVersionRecord {
    if (!params.checkinPolicy?.trim() || !params.childPolicy?.trim() || !params.cancellationSummary?.trim()) {
      throw new BadRequestException(
        'LISTING_POLICY_INCOMPLETE: Phải khai báo đầy đủ checkinPolicy, childPolicy và cancellationSummary trước khi xuất bản.',
      );
    }
    if (!params.amenities || params.amenities.length === 0) {
      throw new BadRequestException('LISTING_AMENITIES_REQUIRED: Phải có ít nhất một tiện nghi chuẩn hóa.');
    }
    if (params.breakfastIncludedInBaseRoom && params.paidBreakfastServiceExists) {
      throw new BadRequestException(
        'BREAKFAST_DISCLOSURE_CONTRADICTION: Không được quảng cáo miễn phí ăn sáng trên trang phòng khi dịch vụ ăn sáng đang cấu hình thu phí bắt buộc.',
      );
    }

    const prev = this.publishedByHotel.get(String(params.hotelId));
    const nextVersion = prev ? prev.version + 1 : 1;
    const payload = {
      hotelId: String(params.hotelId),
      version: nextVersion,
      checkinPolicy: params.checkinPolicy.trim(),
      childPolicy: params.childPolicy.trim(),
      petPolicy: params.petPolicy || 'NO_PETS',
      smokingPolicy: params.smokingPolicy || 'NON_SMOKING',
      cancellationSummary: params.cancellationSummary.trim(),
      amenities: params.amenities,
      breakfastIncludedInBaseRoom: Boolean(params.breakfastIncludedInBaseRoom),
    };
    const policyHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    const record: HotelListingVersionRecord = {
      ...payload,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      policyHash,
    };
    this.publishedByHotel.set(String(params.hotelId), record);
    return record;
  }

  snapshotPolicyForBooking(bookingId: string, hotelId: string): HotelListingVersionRecord {
    const published = this.publishedByHotel.get(String(hotelId));
    if (!published) {
      throw new BadRequestException(`Khách sạn #${hotelId} chưa có phiên bản chính sách được xuất bản (PUBLISHED).`);
    }
    const frozen = { ...published, amenities: [...published.amenities] };
    this.bookingPolicySnapshots.set(String(bookingId), frozen);
    return frozen;
  }

  getBookingFrozenPolicy(bookingId: string): HotelListingVersionRecord | null {
    return this.bookingPolicySnapshots.get(String(bookingId)) || null;
  }
}
