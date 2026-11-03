import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ApprovalRequest,
  ApprovalStatus,
} from './entities/approval-request.entity';
import {
  CreateApprovalRequestDto,
  DecideApprovalRequestDto,
} from './dto/approval.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ApprovalsService {
  constructor(
    @InjectRepository(ApprovalRequest)
    private readonly approvalRepo: Repository<ApprovalRequest>,

    private readonly dataSource: DataSource,
  ) {}

  /**
   * Tạo đề xuất phê duyệt tài chính / giảm giá / hoàn tiền / bồi thường
   */
  async createRequest(dto: CreateApprovalRequestDto, requester: User) {
    let authoritativeHotelId = String(dto.hotelId || '').trim();
    if (dto.bookingId) {
      const [booking] = await this.dataSource.query(
        `SELECT id, hotel_id AS hotelId FROM bookings WHERE id = ? LIMIT 1`,
        [dto.bookingId],
      );
      if (!booking) {
        throw new NotFoundException(`Không tìm thấy đơn đặt phòng #${dto.bookingId}.`);
      }
      if (authoritativeHotelId && String(booking.hotelId) !== authoritativeHotelId) {
        throw new ForbiddenException('hotelId truyền lên không khớp với khách sạn sở hữu đơn đặt phòng.');
      }
      authoritativeHotelId = String(booking.hotelId);
    }
    if (!authoritativeHotelId) {
      throw new BadRequestException('Không xác định được khách sạn của đề xuất phê duyệt.');
    }

    if (requester.role !== 'ADMIN') {
      const isStaff = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [authoritativeHotelId, requester.id],
      );
      if (!isStaff || isStaff.length === 0) {
        throw new ForbiddenException(
          'Bạn không thuộc biên chế nhân sự của khách sạn này để lập đề xuất phê duyệt.',
        );
      }
    }

    const request = this.approvalRepo.create({
      hotelId: authoritativeHotelId,
      bookingId: dto.bookingId || null,
      requestType: dto.requestType,
      requestedBy: requester.id,
      amount: String(dto.amount || 0),
      reason: dto.reason.trim(),
      evidenceUrl: dto.evidenceUrl || null,
      status: ApprovalStatus.PENDING,
    });

    const saved = await this.approvalRepo.save(request);
    return {
      success: true,
      message: 'Đã gửi yêu cầu phê duyệt thành công. Chờ Quản lý khách sạn xét duyệt.',
      data: saved,
    };
  }

  /**
   * Lấy danh sách yêu cầu phê duyệt của khách sạn
   */
  async getRequests(hotelId: string, actor: User, status?: ApprovalStatus) {
    if (actor.role !== 'ADMIN') {
      const isStaff = await this.dataSource.query(
        `SELECT id, staff_role FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [hotelId, actor.id],
      );
      if (!isStaff || isStaff.length === 0) {
        throw new ForbiddenException(
          'Bạn không có quyền truy cập danh sách phê duyệt tại khách sạn này.',
        );
      }
    }

    let query = `
      SELECT
        ar.id,
        ar.hotel_id AS hotelId,
        h.name AS hotelName,
        ar.booking_id AS bookingId,
        b.booking_code AS bookingCode,
        ar.request_type AS requestType,
        ar.requested_by AS requestedBy,
        u_req.full_name AS requesterName,
        u_req.email AS requesterEmail,
        ar.amount,
        ar.reason,
        ar.evidence_url AS evidenceUrl,
        ar.status,
        ar.reviewed_by AS reviewedBy,
        u_rev.full_name AS reviewerName,
        ar.reviewed_at AS reviewedAt,
        ar.review_note AS reviewNote,
        ar.created_at AS createdAt
      FROM approval_requests ar
      LEFT JOIN hotels h ON h.id = ar.hotel_id
      LEFT JOIN bookings b ON b.id = ar.booking_id
      LEFT JOIN users u_req ON u_req.id = ar.requested_by
      LEFT JOIN users u_rev ON u_rev.id = ar.reviewed_by
      WHERE ar.hotel_id = ?
    `;
    const params: any[] = [hotelId];

    if (status) {
      query += ` AND ar.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY ar.created_at DESC`;

    const rows = await this.dataSource.query(query, params);
    return {
      success: true,
      data: rows,
    };
  }

  /**
   * Phê duyệt hoặc từ chối đề xuất tài chính (Bảo đảm nguyên tắc Maker-Checker)
   */
  async decide(id: string, dto: DecideApprovalRequestDto, reviewer: User) {
    const request = await this.approvalRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu phê duyệt.');
    }

    if (request.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException(
        `Yêu cầu này đã được xử lý trước đó với kết quả: ${request.status}.`,
      );
    }

    // 1. Maker-Checker Rule (Section 02.5 & Section 20.3)
    if (String(request.requestedBy) === String(reviewer.id)) {
      throw new ForbiddenException(
        'Nguyên tắc Maker-Checker: Bạn không được phép tự phê duyệt yêu cầu do chính mình khởi tạo.',
      );
    }

    // 2. Manager Authorization Scope (Section 20.3)
    if (reviewer.role !== 'ADMIN') {
      const isManager = await this.dataSource.query(
        `SELECT id FROM hotel_staff WHERE hotel_id = ? AND staff_user_id = ? AND staff_role = 'MANAGER' AND status = 'ACTIVE' LIMIT 1`,
        [request.hotelId, reviewer.id],
      );
      if (!isManager || isManager.length === 0) {
        throw new ForbiddenException(
          'Chỉ Quản lý khách sạn (MANAGER) hoặc Quản trị viên mới có thẩm quyền xét duyệt yêu cầu này.',
        );
      }
    }

    request.status = dto.decision;
    request.reviewedBy = reviewer.id;
    request.reviewedAt = new Date();
    request.reviewNote = dto.reviewNote.trim();

    const saved = await this.approvalRepo.save(request);
    return {
      success: true,
      message: `Đã ${dto.decision === ApprovalStatus.APPROVED ? 'chấp thuận' : 'từ chối'} đề xuất thành công.`,
      data: saved,
    };
  }
}
