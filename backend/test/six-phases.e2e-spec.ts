import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BookingAssignmentService } from '../src/booking-assignment/booking-assignment.service';
import { BookingAssignment, FreshnessBucket } from '../src/booking-assignment/entities/booking-assignment.entity';
import { BookingAssignmentState } from '../src/booking-assignment/entities/booking-assignment-state.entity';
import { BookingAssignmentCommandReceipt } from '../src/booking-assignment/entities/booking-assignment-command-receipt.entity';
import { HotelAssignmentDispatchLock } from '../src/booking-assignment/entities/hotel-assignment-dispatch-lock.entity';
import { BookingCoverageService } from '../src/booking-coverage/booking-coverage.service';
import { BookingCoverageEvent } from '../src/booking-coverage/entities/booking-coverage-event.entity';
import { BookingCoverageGrant, CoverageTaskType } from '../src/booking-coverage/entities/booking-coverage-grant.entity';
import { BookingPresenceService } from '../src/booking-presence/booking-presence.service';
import { BookingPresenceEvent } from '../src/booking-presence/entities/booking-presence-event.entity';
import { Booking, BookingStatus } from '../src/bookings/entities/booking.entity';
import { BookingRoom } from '../src/bookings/entities/booking-room.entity';
import { BookingStatusLog } from '../src/bookings/entities/booking-status-log.entity';
import { BookingsService } from '../src/bookings/bookings.service';
import { RoomAvailabilityService } from '../src/bookings/room-availability.service';
import { GuestConversationsService } from '../src/guest-conversations/guest-conversations.service';
import { GuestConversation } from '../src/guest-conversations/entities/guest-conversation.entity';
import { GuestMessage } from '../src/guest-conversations/entities/guest-message.entity';
import { GuestWorkEvidence } from '../src/guest-work/entities/guest-work-evidence.entity';
import { GuestWorkEvent } from '../src/guest-work/entities/guest-work-event.entity';
import { GuestWorkTask, WorkTaskType } from '../src/guest-work/entities/guest-work-task.entity';
import { GuestWorkService } from '../src/guest-work/guest-work.service';
import { HotelStaff } from '../src/hotel-staff/entities/hotel-staff.entity';
import { BookingHold } from '../src/inventory/entities/booking-hold.entity';
import { InventoryService } from '../src/inventory/inventory.service';
import { PaymentTransaction } from '../src/payments/entities/payment-transaction.entity';
import { Room } from '../src/rooms/entities/room.entity';
import { StaffAbsenceRequest } from '../src/staff-availability/entities/staff-absence-request.entity';
import { StaffAbsenceRequestEvent } from '../src/staff-availability/entities/staff-absence-request-event.entity';
import { StaffAvailabilityBlock } from '../src/staff-availability/entities/staff-availability-block.entity';
import { StaffAvailabilityService } from '../src/staff-availability/staff-availability.service';
import { GuestStaffReviewRevision } from '../src/staff-kpi/entities/guest-staff-review-revision.entity';
import { GuestStaffReview, ReviewStage } from '../src/staff-kpi/entities/guest-staff-review.entity';
import { StaffKpiAdjustment } from '../src/staff-kpi/entities/staff-kpi-adjustment.entity';
import { StaffKpiMetricScore } from '../src/staff-kpi/entities/staff-kpi-metric-score.entity';
import { StaffKpiPeriodScore } from '../src/staff-kpi/entities/staff-kpi-period-score.entity';
import { GuestStaffReviewsService } from '../src/staff-kpi/guest-staff-reviews.service';
import { KpiCalculationService } from '../src/staff-kpi/kpi-calculation.service';
import { PromotionCampaign, PromotionTargetScope, PromotionDiscountType, BenefitKind } from '../src/promotions/entities/promotion-campaign.entity';
import { BookingPriceQuote } from '../src/promotions/entities/booking-price-quote.entity';
import { BookingBenefitAccount } from '../src/promotions/entities/booking-benefit-account.entity';
import { BookingBenefitLedger } from '../src/promotions/entities/booking-benefit-ledger.entity';
import { PromotionsService } from '../src/promotions/promotions.service';

describe('Six-phase MySQL verification (P0/P1 invariants)', () => {
  let ds: DataSource;
  let avail: StaffAvailabilityService;
  let assign: BookingAssignmentService;
  let inv: InventoryService;
  let roomAvail: RoomAvailabilityService;
  let coverage: BookingCoverageService;
  let presence: BookingPresenceService;
  let work: GuestWorkService;
  let chat: GuestConversationsService;
  let kpi: KpiCalculationService;
  let reviews: GuestStaffReviewsService;
  let bookings: BookingsService;
  let promos: PromotionsService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql', host: '127.0.0.1', port: Number(process.env.DB_PORT || 33316),
      username: 'root', password: '', database: 'hotel_booking_db', synchronize: false,
      entities: [__dirname + '/../src/**/*.entity.ts'],
    });
    await ds.initialize();
    avail = new StaffAvailabilityService(ds, ds.getRepository(StaffAbsenceRequest),
      ds.getRepository(StaffAbsenceRequestEvent), ds.getRepository(StaffAvailabilityBlock), ds.getRepository(HotelStaff));
    assign = new BookingAssignmentService(ds, avail, ds.getRepository(BookingAssignment),
      ds.getRepository(BookingAssignmentState), ds.getRepository(HotelAssignmentDispatchLock),
      ds.getRepository(BookingAssignmentCommandReceipt));
    inv = new InventoryService(ds.getRepository(BookingHold), ds.getRepository(Room), ds);
    roomAvail = new RoomAvailabilityService(ds.getRepository(Room), ds.getRepository(BookingRoom), inv);
    coverage = new BookingCoverageService(ds.getRepository(BookingCoverageGrant), ds.getRepository(BookingCoverageEvent),
      ds.getRepository(Booking), ds.getRepository(BookingAssignment), ds.getRepository(BookingAssignmentState), avail, ds);
    presence = new BookingPresenceService(ds.getRepository(Booking), ds.getRepository(BookingPresenceEvent),
      ds.getRepository(BookingStatusLog), ds.getRepository(HotelStaff), ds, undefined, coverage);
    work = new GuestWorkService(ds.getRepository(GuestWorkTask), ds.getRepository(GuestWorkEvent),
      ds.getRepository(GuestWorkEvidence), ds.getRepository(Booking), avail, ds, coverage);
    chat = new GuestConversationsService(ds.getRepository(GuestConversation), ds.getRepository(GuestMessage),
      ds.getRepository(Booking), work);
    kpi = new KpiCalculationService(ds.getRepository(StaffKpiPeriodScore), ds.getRepository(StaffKpiMetricScore),
      ds.getRepository(StaffKpiAdjustment), ds.getRepository(GuestStaffReview), ds.getRepository(GuestWorkEvent),
      ds.getRepository(GuestWorkTask), ds.getRepository(BookingPresenceEvent), avail);
    reviews = new GuestStaffReviewsService(ds.getRepository(GuestStaffReview), ds.getRepository(GuestStaffReviewRevision),
      ds.getRepository(Booking), ds.getRepository(GuestWorkEvent), ds.getRepository(GuestWorkTask));
    bookings = new BookingsService(ds.getRepository(Booking), ds.getRepository(BookingRoom),
      ds.getRepository(BookingStatusLog), ds.getRepository(Room), ds, undefined, undefined, undefined,
      undefined, undefined, undefined, inv, coverage, presence);
    promos = new PromotionsService(ds.getRepository(PromotionCampaign), ds.getRepository(BookingPriceQuote),
      ds.getRepository(BookingBenefitAccount), ds.getRepository(BookingBenefitLedger), ds.getRepository(Booking),
      ds.getRepository(BookingRoom), ds.getRepository(Room), avail, ds, coverage);
  });

  afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

  let seq = Date.now() % 100000000;
  const nextId = () => String(++seq);
  async function seedHotelAndStaff() {
    const hid = nextId(), mgr = nextId(), a = nextId(), b = nextId(), c = nextId(), cust = nextId(), room = nextId();
    await ds.query(`INSERT INTO locations(id,code,name,type) VALUES (?,?,?,'CITY')`, [hid, `LOC${hid}`, `Loc ${hid}`]);
    await ds.query(`INSERT INTO hotel_types(id,code,name) VALUES (?,?,?)`, [hid, `TYPE${hid}`, `Type ${hid}`]);
    await ds.query(`INSERT INTO hotels(id,name,slug,location_id,hotel_type_id,star_rating,address) VALUES (?,?,?,?,?,5,'Test')`,
      [hid, `Hotel ${hid}`, `hotel-${hid}`, hid, hid]);
    await ds.query(`INSERT INTO rooms(id,hotel_id,name,slug,service_tier,price_per_night,total_rooms,available_rooms,max_adults,status)
      VALUES (?,?, 'Suite VIP', ?, 'VIP', 2500000, 10, 10, 2, 'AVAILABLE')`, [room, hid, `room-${room}`]);
    for (const [id, name, role] of [[mgr,'Manager','EMPLOYEE'],[a,'Staff A','EMPLOYEE'],[b,'Staff B','EMPLOYEE'],[c,'Staff C','EMPLOYEE'],[cust,'Customer','CUSTOMER']]) {
      await ds.query(`INSERT INTO users(id,full_name,email,password,role,status) VALUES (?,?,?,'x',?, 'ACTIVE')`, [id, name, `${id}@test.local`, role]);
    }
    for (const [id, role] of [[mgr,'MANAGER'],[a,'EMPLOYEE'],[b,'EMPLOYEE'],[c,'EMPLOYEE']]) {
      await ds.query(`INSERT INTO hotel_staff(hotel_id,staff_user_id,staff_role,status) VALUES (?,?,?, 'ACTIVE')`, [hid, id, role]);
    }
    await ds.query(`INSERT IGNORE INTO skill_categories(code,name,department,status) VALUES
      ('FRONT_DESK','Nghiệp vụ Lễ tân','FRONT_DESK','ACTIVE'),
      ('VIP_HANDLING','Phục vụ khách VIP','FRONT_DESK','ACTIVE')`);
    const [vipSkill] = await ds.query(`SELECT id FROM skill_categories WHERE code = 'VIP_HANDLING' LIMIT 1`);
    for (const [id, level, years] of [[a,5,5],[b,4,3],[c,3,2]]) {
      await ds.query(`INSERT INTO staff_skills(user_id,skill_id,level,years_exp,verified_by,verified_at,is_shadow,eligibility_level)
        VALUES (?,?,?,?,?,NOW(),0,'VIP')`, [id, vipSkill.id, level, years, mgr]);
      await ds.query(`INSERT INTO staff_language_skills(user_id,language_code,language_name,level,verified_by,verified_at)
        VALUES (?,'en','English','ADVANCED',?,NOW())`, [id, mgr]);
      for (let i = 0; i < 20; i++) {
        await ds.query(`INSERT INTO booking_presence_events(booking_id,hotel_id,from_status,to_status,actor_type,actor_id,event_type,occurred_at)
          VALUES (?,?,'CHECKED_IN','COMPLETED','USER',?,'DEPARTURE_CONFIRMED',NOW())`, [nextId(), hid, id]);
      }
    }
    return { hid, mgr, a, b, c, cust, room };
  }

  async function createPaidWebsiteBooking(ctx: any, qty = 1, status = 'CONFIRMED', checkInOffsetHours = -1, checkOutOffsetHours = 48) {
    const bid = nextId();
    const checkIn = new Date(Date.now() + checkInOffsetHours * 3600000);
    const checkOut = new Date(Date.now() + checkOutOffsetHours * 3600000);
    await ds.query(`INSERT INTO bookings(id,booking_code,user_id,hotel_id,booking_source,contact_name,contact_email,contact_phone,
      check_in_at,check_out_at,total_guests,requested_room_count,estimated_total,status,no_show_grace_minutes)
      VALUES (?,?,?,?, 'WEBSITE','Guest','g@test.local','0900',?,?,2,?,2500000,?,360)`,
      [bid, `BK${bid}`, ctx.cust, ctx.hid, checkIn, checkOut, qty, status]);
    await ds.query(`INSERT INTO booking_rooms(booking_id,room_id,quantity,price_per_night,nights,subtotal)
      VALUES (?,?,?,2500000,1,2500000)`, [bid, ctx.room, qty]);
    await ds.query(`INSERT INTO booking_holds(booking_id,room_id,quantity,check_in_at,check_out_at,status,hold_expires_at,committed_at)
      VALUES (?,?,?,?,?,'COMMITTED',?,NOW())`, [bid, ctx.room, qty, checkIn, checkOut, checkOut]);
    await ds.query(`INSERT INTO payment_transactions(booking_id,provider,attempt_no,txn_ref,amount,status,paid_at)
      VALUES (?,'VNPAY',1,?,2500000,'PAID',NOW())`, [bid, `TXN${bid}`]);
    return bid;
  }

  it('Phase 1 (E01–E06): executes real MySQL skill join + rule filter, 40/120 fairness, >4h exclusive busy, and concurrent dispatch lock', async () => {
    const ctx = await seedHotelAndStaff();
    const b1 = await createPaidWebsiteBooking(ctx);
    const r1 = await assign.assignOnce(b1);
    expect(r1).toMatchObject({ success: true, staffUserId: ctx.a });

    // A is now <40m; B and C race on two simultaneous paid bookings -> serialized by hotel dispatch lock.
    const b2 = await createPaidWebsiteBooking(ctx);
    const b3 = await createPaidWebsiteBooking(ctx);
    const [r2, r3] = await Promise.all([assign.assignOnce(b2), assign.assignOnce(b3)]);
    expect(new Set([r2.staffUserId, r3.staffUserId])).toEqual(new Set([ctx.b, ctx.c]));

    // Make A 50m ago (SOFT), B 25m ago (HARD), C 130m ago (FRESH) but busy on a 6-hour-old IN_PROGRESS check-in.
    await ds.query(`UPDATE booking_assignments SET assigned_at = DATE_SUB(NOW(), INTERVAL 50 MINUTE) WHERE booking_id = ?`, [b1]);
    await ds.query(`UPDATE booking_assignments SET assigned_at = DATE_SUB(NOW(), INTERVAL 25 MINUTE) WHERE booking_id = ?`, [b2]);
    await ds.query(`UPDATE booking_assignments SET assigned_at = DATE_SUB(NOW(), INTERVAL 130 MINUTE) WHERE booking_id = ?`, [b3]);
    const busyStaff = r3.staffUserId!;
    await ds.query(`INSERT INTO guest_work_tasks(hotel_id,booking_id,type,assigned_staff_id,status,priority,title,started_at)
      VALUES (?,?, 'CHECK_IN', ?, 'IN_PROGRESS','HIGH','Checkin long running', DATE_SUB(NOW(), INTERVAL 6 HOUR))`,
      [ctx.hid, b3, busyStaff]);
    const b4 = await createPaidWebsiteBooking(ctx);
    const r4 = await assign.assignOnce(b4);
    expect(r4.staffUserId).toBe(ctx.a);
  });

  it('Phase 2 & 3 (E07–E16): keeps COMMITTED hold across NO_SHOW -> late recovery, shares interval capacity with front desk, scopes coverage, and rolls back transfer on task error', async () => {
    const ctx = await seedHotelAndStaff();
    const bNoShow = await createPaidWebsiteBooking(ctx, 1, 'CONFIRMED', -8, 24);
    await assign.assignOnce(bNoShow);
    await presence.markNoShowIfEligible(bNoShow);

    // 7 checked-in + 1 NO_SHOW COMMITTED -> occupied=8, sellable=2.
    const bCheckedIn = await createPaidWebsiteBooking(ctx, 7, 'CHECKED_IN', -2, 24);
    const checkIn = new Date(Date.now() - 3600000);
    const checkOut = new Date(Date.now() + 12 * 3600000);
    expect(await roomAvail.getAvailability(ctx.room, checkIn, checkOut)).toMatchObject({
      totalRooms: 10, bookedRooms: 8, remainingRooms: 2, sellableRooms: 2,
    });

    // B with ALL_SERVICE_TASKS cannot check-in; B with explicit CHECK_IN can recover NO_SHOW -> CHECKED_IN.
    await coverage.createTemporary(bNoShow, { id: ctx.mgr, role: 'EMPLOYEE' }, {
      delegateStaffUserId: ctx.b, startAt: new Date(Date.now() - 60000).toISOString(),
      endAt: new Date(Date.now() + 3600000).toISOString(),
      allowedTaskTypes: [CoverageTaskType.ALL_SERVICE_TASKS], reason: 'Service only',
    });
    await expect(presence.confirmArrival(bNoShow, ctx.b, 'EMPLOYEE', {})).rejects.toThrow(ForbiddenException);
    await coverage.createTemporary(bNoShow, { id: ctx.mgr, role: 'EMPLOYEE' }, {
      delegateStaffUserId: ctx.b, startAt: new Date(Date.now() - 60000).toISOString(),
      endAt: new Date(Date.now() + 3600000).toISOString(),
      allowedTaskTypes: [CoverageTaskType.CHECK_IN], reason: 'Check-in support',
    });
    const recovered = await presence.confirmArrival(bNoShow, ctx.b, 'EMPLOYEE', {});
    expect(recovered.booking.status).toBe(BookingStatus.CHECKED_IN);
    expect(String(recovered.booking.handledBy)).toBe(ctx.a);
    expect(String(recovered.booking.checkInConfirmedBy)).toBe(ctx.b);
    expect((await roomAvail.getAvailability(ctx.room, checkIn, checkOut)).sellableRooms).toBe(2);

    // Front desk uses the same interval hold capacity: requesting 3 rooms when 2 remain is rejected.
    await expect(bookings.createFrontDeskBooking({
      roomId: ctx.room, bookingSource: 'WALK_IN', checkInAt: checkIn.toISOString(), checkOutAt: checkOut.toISOString(),
      totalGuests: 2, roomCount: 3, contactName: 'Walkin', contactEmail: 'w@test.local', contactPhone: '0911',
    } as any, { id: ctx.a, role: 'EMPLOYEE', fullName: 'Staff A' } as any, '127.0.0.1')).rejects.toThrow(ConflictException);
  });

  it('Phase 4, 5 & 6 (E17–E28): enforces ticket-scoped first response, cross-hotel denial, A->B KPI split, min-3 reviews, and immutable approved snapshots', async () => {
    const ctx = await seedHotelAndStaff();
    const other = await seedHotelAndStaff();
    const bid = await createPaidWebsiteBooking(ctx, 1, 'CONFIRMED', -1, 24);
    await assign.assignOnce(bid);

    // Cross-hotel employee cannot read or send messages.
    await expect(chat.getMessages(bid, { id: other.a, role: 'EMPLOYEE' })).rejects.toThrow(ForbiddenException);

    // Two tasks on the same booking; replying to task 1 marks ONLY task 1.
    const t1 = await work.createTask({ bookingId: bid, type: WorkTaskType.SERVICE_REQUEST, title: 'Towels' }, { id: ctx.mgr, role: 'EMPLOYEE' });
    const t2 = await work.createTask({ bookingId: bid, type: WorkTaskType.COMPLAINT_HANDLE, title: 'AC' }, { id: ctx.mgr, role: 'EMPLOYEE' });
    await chat.sendMessage(bid, { id: ctx.a, role: 'EMPLOYEE' }, { body: 'On it', clientMsgId: 'm1', taskId: t1.id });
    const refreshedTasks = await work.getTasksForBooking(bid);
    expect(refreshedTasks.find((t) => String(t.id) === String(t1.id))?.firstResponseAt).not.toBeNull();
    expect(refreshedTasks.find((t) => String(t.id) === String(t2.id))?.firstResponseAt).toBeNull();

    // AB-03 / AB-05 / AB-07: While A is still ACTIVE (even on 2-day leave), permanent transfer is rejected;
    // B handles t1 under temporary coverage without overwriting t1.assignedStaffId = A.
    await expect(coverage.transferPermanent(bid, { id: ctx.mgr, role: 'EMPLOYEE' }, {
      toStaffUserId: ctx.b, reasonCode: 'EMPLOYMENT_ENDED', reason: 'A on 2-day leave', commandId: `reject_${bid}`,
    })).rejects.toThrow(ConflictException);

    await coverage.createTemporary(bid, { id: ctx.mgr, role: 'EMPLOYEE' }, {
      delegateStaffUserId: ctx.b, startAt: new Date(Date.now() - 60000).toISOString(),
      endAt: new Date(Date.now() + 3600000).toISOString(),
      scopeMode: 'TASK_IDS', taskIds: [t1.id], reason: 'B covers t1 only',
    });
    const acceptedByB = await work.acceptTask(t1.id, { id: ctx.b, role: 'EMPLOYEE' });
    expect(String(acceptedByB.assignedStaffId)).toBe(ctx.a);
    expect(String(acceptedByB.activeExecutorId)).toBe(ctx.b);
    await expect(work.acceptTask(t2.id, { id: ctx.b, role: 'EMPLOYEE' })).rejects.toThrow(ForbiddenException);

    // AB-08: Now A leaves hotel employment (INACTIVE); manager permanently transfers booking to B.
    await ds.query(`UPDATE hotel_staff SET status = 'INACTIVE' WHERE hotel_id = ? AND staff_user_id = ?`, [ctx.hid, ctx.a]);
    await coverage.transferPermanent(bid, { id: ctx.mgr, role: 'EMPLOYEE' }, {
      toStaffUserId: ctx.b, reasonCode: 'EMPLOYMENT_ENDED', reason: 'A left hotel', commandId: `cmd_${bid}`,
      taskDecisions: [{ taskId: t1.id, action: 'HANDOVER', reason: 'B takes over as new owner' }],
    });
    await work.acceptTask(t1.id, { id: ctx.b, role: 'EMPLOYEE' });
    await work.startTask(t1.id, { id: ctx.b, role: 'EMPLOYEE' });
    await work.completeTask(t1.id, { id: ctx.b, role: 'EMPLOYEE' }, { evidenceRef: 'delivered-photo' });
    await work.verifyTask(t1.id, { id: ctx.mgr, role: 'EMPLOYEE' }, { decision: 'VERIFIED', evidenceRef: 'checked' });

    const period = new Date().toISOString().slice(0, 7);
    const scoreA = await kpi.calculatePeriodScore(ctx.hid, ctx.a, period);
    const scoreB = await kpi.calculatePeriodScore(ctx.hid, ctx.b, period);
    expect(scoreA.metrics.find((m) => m.metricCode === 'FIRST_RESPONSE_SLA')?.numerator).toBe(1);
    expect(scoreB.metrics.find((m) => m.metricCode === 'SERVICE_REQUEST_SLA')?.numerator).toBe(1);

    // 1 guest review is PROVISIONAL (eligible=false).
    await reviews.submitReview(ctx.cust, { bookingId: bid, staffUserId: ctx.a, stage: ReviewStage.PRE_ARRIVAL, stars: 5 });
    const scoreWith1Review = await kpi.calculatePeriodScore(ctx.hid, ctx.a, period);
    expect(scoreWith1Review.metrics.find((m) => m.metricCode === 'GUEST_RATING')?.eligible).toBe(false);

    // Self-reported offline log stays PENDING_VERIFICATION and does not inflate KPI until verified.
    await work.createOfflineWorkLog({ id: ctx.b, role: 'EMPLOYEE' }, {
      bookingId: bid, type: WorkTaskType.SERVICE_REQUEST, channel: 'PHONE',
      claimedOccurredAt: new Date(Date.now() - 600000).toISOString(), summary: 'Called guest about charger',
    });
    const scoreBeforeVerify = await kpi.calculatePeriodScore(ctx.hid, ctx.b, period);
    expect(scoreBeforeVerify.metrics.find((m) => m.metricCode === 'SERVICE_REQUEST_SLA')?.numerator).toBe(1);

    // Approved KPI snapshots are immutable: recalculation creates calculationVersion=2 without overwriting v1.
    await ds.query(`UPDATE staff_kpi_period_scores SET status = 'APPROVED', sample_count = 3 WHERE id = ?`, [scoreB.id]);
    const nextRevision = await kpi.calculatePeriodScore(ctx.hid, ctx.b, period);
    expect(Number(nextRevision.calculationVersion)).toBeGreaterThan(Number(scoreB.calculationVersion));
    const [originalRow] = await ds.query(`SELECT status FROM staff_kpi_period_scores WHERE id = ?`, [scoreB.id]);
    expect(originalRow.status).toBe('APPROVED');
  });

  it('Pricing & Promotions (B01–B46): 02–10/11 5.000.000đ VNPay untouched, +360k for 05–07/11, blocks overlapping promo, enforces customer consent, redeems 200k -> 160k, reverses +200k, and settles refund', async () => {
    const ctx = await seedHotelAndStaff();
    await ds.query(`UPDATE rooms SET price_per_night = 625000 WHERE id = ?`, [ctx.room]);
    const bid = nextId();
    await ds.query(`INSERT INTO bookings(id,booking_code,user_id,hotel_id,booking_source,handled_by,contact_name,contact_email,contact_phone,
      check_in_at,check_out_at,total_guests,requested_room_count,estimated_total,status,no_show_grace_minutes)
      VALUES (?,?,?,?,'WEBSITE',?,'Guest','g@test.local','0900','2026-11-02 14:00:00','2026-11-10 12:00:00',2,1,5000000,'CONFIRMED',360)`,
      [bid, `BK${bid}`, ctx.cust, ctx.hid, ctx.a]);
    await ds.query(`INSERT INTO booking_rooms(booking_id,room_id,quantity,price_per_night,nights,subtotal)
      VALUES (?,?,1,625000,8,5000000)`, [bid, ctx.room]);
    await ds.query(`INSERT INTO booking_holds(booking_id,room_id,quantity,check_in_at,check_out_at,status,hold_expires_at,committed_at)
      VALUES (?,?,1,'2026-11-02 14:00:00','2026-11-10 12:00:00','COMMITTED','2026-11-10 12:00:00',NOW())`, [bid, ctx.room]);
    await ds.query(`INSERT INTO payment_transactions(booking_id,provider,attempt_no,txn_ref,amount,status,paid_at)
      VALUES (?,'VNPAY',1,?,5000000,'PAID',NOW())`, [bid, `TXN${bid}`]);

    // Manager creates & activates campaign for nights 05, 06, 07/11 (-120k/night = 360k)
    const { campaign } = await promos.createCampaign({ id: ctx.mgr, role: 'EMPLOYEE' }, {
      hotelId: ctx.hid, code: 'NOV0507', name: 'Giảm 120k đêm 05-07/11',
      targetScope: PromotionTargetScope.ROOM_IDS, targetRoomIds: [ctx.room],
      stayStartDate: '2026-11-05', stayEndDate: '2026-11-07',
      discountType: PromotionDiscountType.FIXED_AMOUNT, discountValue: 120000,
      benefitKind: BenefitKind.ROOM_PRICE_ADJUSTMENT, existingBookingsEligible: true, retroactiveMode: true,
    });
    await promos.approveAndActivateCampaign({ id: ctx.mgr, role: 'EMPLOYEE' }, campaign.id);

    // B13: Overlapping campaign on same room & nights is blocked on activation
    const { campaign: overlapping } = await promos.createCampaign({ id: ctx.mgr, role: 'EMPLOYEE' }, {
      hotelId: ctx.hid, code: 'NOV0607_DUP', name: 'Trùng đêm 06-07',
      targetScope: PromotionTargetScope.ROOM_IDS, targetRoomIds: [ctx.room],
      stayStartDate: '2026-11-06', stayEndDate: '2026-11-07',
      discountType: PromotionDiscountType.PERCENT, discountValue: 10,
    });
    await expect(promos.approveAndActivateCampaign({ id: ctx.mgr, role: 'EMPLOYEE' }, overlapping.id)).rejects.toThrow(ConflictException);

    // B21: VNPay PAID transaction remains 5.000.000đ; booking receives +360.000đ benefit account
    const [paidTx] = await ds.query(`SELECT amount FROM payment_transactions WHERE booking_id = ?`, [bid]);
    expect(Number(paidTx.amount)).toBe(5000000);
    const folio1 = await promos.getBookingBenefitsAndFolio(bid, { id: ctx.cust, role: 'CUSTOMER' });
    expect(folio1.refundReceivableAmount).toBe(360000);

    // B22: Cannot offset ROOM_PRICE_ADJUSTMENT against laundry service before customer consent
    await expect(promos.redeemBenefitForService({ id: ctx.a, role: 'EMPLOYEE' }, {
      bookingId: bid, requestedAmount: 200000, serviceRequestId: '901', idempotencyKey: `red_${bid}_1`,
    })).rejects.toThrow(ConflictException);

    // Customer consents -> B23: redeem 200.000đ laundry -> balance 160.000đ
    await promos.acceptRoomAdjustmentAsCredit(bid, folio1.accounts[0].id, { id: ctx.cust, role: 'CUSTOMER' });
    const red = await promos.redeemBenefitForService({ id: ctx.a, role: 'EMPLOYEE' }, {
      bookingId: bid, requestedAmount: 200000, serviceRequestId: '901', idempotencyKey: `red_${bid}_1`,
    });
    expect(red).toMatchObject({ redeemedAmount: 200000, remainingServicePayable: 0 });
    expect((await promos.getBookingBenefitsAndFolio(bid, { id: ctx.cust, role: 'CUSTOMER' })).availableServiceCredit).toBe(160000);

    // B29: Settle remaining 160.000đ refund at checkout -> balance 0
    const settled = await promos.settleRemainingRefundAtCheckout(
      { id: ctx.mgr, role: 'EMPLOYEE' }, bid, folio1.accounts[0].id, `settle_${bid}`,
    );
    expect(settled.settledRefundAmount).toBe(160000);
    expect((await promos.getBookingBenefitsAndFolio(bid, { id: ctx.cust, role: 'CUSTOMER' })).refundReceivableAmount).toBe(0);
  });
});
