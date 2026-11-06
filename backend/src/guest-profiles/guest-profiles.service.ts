import { ForbiddenException, Injectable } from '@nestjs/common';

export interface GuestPreferenceProfile {
  userId: string;
  preferredBedType: string | null;
  preferredFloor: string | null;
  quietRoom: boolean;
  dietaryNotes: string | null;
  preferenceConsent: boolean;
  marketingConsent: boolean;
  consentUpdatedAt: Date;
}

@Injectable()
export class GuestProfilesService {
  private readonly profiles = new Map<string, GuestPreferenceProfile>();

  upsertPreferencesAndConsent(
    userId: string,
    dto: {
      preferredBedType?: string | null;
      preferredFloor?: string | null;
      quietRoom?: boolean;
      dietaryNotes?: string | null;
      preferenceConsent: boolean;
      marketingConsent: boolean;
    },
  ): GuestPreferenceProfile {
    const record: GuestPreferenceProfile = {
      userId: String(userId),
      preferredBedType: dto.preferenceConsent ? dto.preferredBedType || null : null,
      preferredFloor: dto.preferenceConsent ? dto.preferredFloor || null : null,
      quietRoom: dto.preferenceConsent ? Boolean(dto.quietRoom) : false,
      dietaryNotes: dto.preferenceConsent ? dto.dietaryNotes || null : null,
      preferenceConsent: Boolean(dto.preferenceConsent),
      marketingConsent: Boolean(dto.marketingConsent),
      consentUpdatedAt: new Date(),
    };
    this.profiles.set(String(userId), record);
    return record;
  }

  revokeMarketingConsent(userId: string): GuestPreferenceProfile {
    const existing = this.profiles.get(String(userId)) || {
      userId: String(userId),
      preferredBedType: null,
      preferredFloor: null,
      quietRoom: false,
      dietaryNotes: null,
      preferenceConsent: false,
      marketingConsent: false,
      consentUpdatedAt: new Date(),
    };
    existing.marketingConsent = false;
    existing.consentUpdatedAt = new Date();
    this.profiles.set(String(userId), existing);
    return existing;
  }

  deletePersonalPreferencesWithoutDeletingFinancialLedger(userId: string) {
    this.profiles.delete(String(userId));
    return {
      userId: String(userId),
      preferencesErased: true,
      financialFolioAndReceiptsPreserved: true,
    };
  }

  getScopedGuestSummaryForStaff(
    userId: string,
    bookingHotelId: string,
    staffHotelId: string,
  ) {
    if (String(bookingHotelId) !== String(staffHotelId)) {
      throw new ForbiddenException('CROSS_HOTEL_GUEST_PROFILE_FORBIDDEN: Nhân sự khách sạn khác không được truy cập hồ sơ sở thích của khách.');
    }
    return this.profiles.get(String(userId)) || null;
  }
}
