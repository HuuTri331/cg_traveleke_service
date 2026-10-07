import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST', 'smtp.gmail.com');
    const port = Number(this.configService.get<number>('MAIL_PORT', 465));
    const secure =
      this.configService.get<string>('MAIL_SECURE', 'true') === 'true' ||
      port === 465;
    const user = this.configService.get<string>(
      'MAIL_USER',
      'dangquangminhdn76@gmail.com',
    );
    const rawPass =
      this.configService.get<string>('MAIL_PASS') ||
      process.env.MAIL_PASS ||
      '';
    // Bỏ qua dấu cách nếu có trong mật khẩu ứng dụng Gmail
    const pass = rawPass.replace(/\s+/g, '');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    // Kiểm tra kết nối SMTP lúc khởi tạo
    this.transporter.verify((err) => {
      if (err) {
        this.logger.error(`SMTP Connection failed: ${err.message}`);
      } else {
        this.logger.log('SMTP Server is ready to deliver verification emails.');
      }
    });
  }

  /**
   * Gửi email xác thực tài khoản cho khách hàng mới đăng ký
   */
  async sendVerificationEmail(
    to: string,
    fullName: string,
    token: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}&email=${encodeURIComponent(to)}`;
    const from = this.configService.get<string>(
      'MAIL_FROM',
      '"Traveleke Support" <dangquangminhdn76@gmail.com>',
    );

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Xác Thực Tài Khoản Traveleke</title>
      <style>
        body { margin: 0; padding: 0; background-color: #f4f7fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 36px 30px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
        .header p { color: #dbeafe; margin: 8px 0 0 0; font-size: 14px; }
        .content { padding: 36px 32px; color: #334155; line-height: 1.6; }
        .greeting { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
        .btn-wrapper { text-align: center; margin: 32px 0; }
        .btn { display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 10px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35); transition: all 0.2s ease; }
        .link-fallback { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 12px; color: #64748b; word-break: break-all; margin-top: 24px; }
        .footer { background-color: #f8fafc; padding: 24px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
        .footer p { margin: 4px 0; }
        .badge { display: inline-block; background-color: #eff6ff; color: #1d4ed8; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✈️ Traveleke</h1>
          <p>Nền tảng đặt phòng và du lịch trực tuyến hàng đầu</p>
        </div>
        <div class="content">
          <div class="badge">XÁC THỰC EMAIL</div>
          <div class="greeting">Xin chào ${fullName || 'Quý khách'},</div>
          <p>Cảm ơn bạn đã đăng ký tài khoản tại <strong>Traveleke</strong>! Để bảo vệ tài khoản và kích hoạt đầy đủ các quyền lợi đặt phòng khách sạn, vui lòng nhấn vào nút xác thực bên dưới:</p>
          
          <div class="btn-wrapper">
            <a href="${verifyUrl}" class="btn" target="_blank">Xác Thực Tài Khoản Ngay</a>
          </div>

          <p style="font-size: 13px; color: #64748b;">
            ⚠️ <em>Liên kết xác thực này có hiệu lực trong vòng <strong>24 giờ</strong>.</em>
          </p>

          <div class="link-fallback">
            Nếu nút bấm trên không hoạt động, bạn có thể sao chép và dán liên kết sau vào trình duyệt:<br>
            <a href="${verifyUrl}" style="color: #2563eb;">${verifyUrl}</a>
          </div>
        </div>
        <div class="footer">
          <p>Nếu bạn không thực hiện đăng ký tài khoản tại Traveleke, vui lòng bỏ qua email này.</p>
          <p>© 2026 Traveleke Inc. Mọi quyền được bảo lưu.</p>
        </div>
      </div>
    </body>
    </html>
    `;

    try {
      const info = await this.transporter.sendMail({
        from,
        to,
        subject: '✈️ [Traveleke] Kích hoạt và xác thực tài khoản khách hàng',
        html: htmlContent,
      });
      this.logger.log(`Verification email sent to ${to}: ${info.messageId}`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send verification email to ${to}: ${msg}`);
      throw new Error(`Không thể gửi email xác thực: ${msg}`);
    }
  }

  /**
   * Section 37: Gửi email xác nhận thanh toán thành công (VNPay)
   */
  async sendPaymentSuccessEmail(
    to: string,
    data: {
      bookingCode: string;
      contactName: string;
      amount: number | string;
      vnpTransactionNo: string;
      checkInAt: Date | string;
      checkOutAt: Date | string;
      hotelName?: string;
      roomName?: string;
    },
  ): Promise<boolean> {
    const from = this.configService.get<string>(
      'MAIL_FROM',
      '"Traveleke" <dangquangminhdn76@gmail.com>',
    );
    const formattedAmount = Number(data.amount).toLocaleString('vi-VN');

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <style>
        body { margin:0; padding:0; background:#f4f7fb; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
        .box { max-width:600px; margin:30px auto; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,0.06); }
        .hdr { background:#0284c7; padding:28px 24px; text-align:center; color:#ffffff; }
        .content { padding:28px 24px; color:#334155; line-height:1.6; }
        .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:14px; }
        .label { color:#64748b; }
        .val { font-weight:600; color:#0f172a; }
        .ftr { background:#f8fafc; padding:18px; text-align:center; font-size:12px; color:#94a3b8; }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="hdr">
          <h2 style="margin:0;">✅ Thanh Toán Đặt Phòng Thành Công</h2>
          <p style="margin:6px 0 0 0; font-size:14px; opacity:0.9;">Cổng thanh toán VNPay</p>
        </div>
        <div class="content">
          <p>Xin chào <strong>${data.contactName}</strong>,</p>
          <p>Traveleke đã nhận được khoản thanh toán cho đơn đặt phòng của bạn. Trạng thái hiện tại: <strong>Đã thanh toán - Đang chờ khách sạn xác nhận</strong>.</p>
          <div style="background:#f8fafc; border-radius:10px; padding:16px; margin:20px 0;">
            <div class="row"><span class="label">Mã đặt phòng:</span><span class="val">${data.bookingCode}</span></div>
            <div class="row"><span class="label">Số tiền:</span><span class="val" style="color:#0284c7;">${formattedAmount} VND</span></div>
            <div class="row"><span class="label">Mã giao dịch VNPay:</span><span class="val">${data.vnpTransactionNo}</span></div>
            <div class="row"><span class="label">Thời gian nhận phòng:</span><span class="val">${new Date(data.checkInAt).toLocaleString('vi-VN')}</span></div>
            <div class="row"><span class="label">Thời gian trả phòng:</span><span class="val">${new Date(data.checkOutAt).toLocaleString('vi-VN')}</span></div>
          </div>
          <p style="font-size:13px; color:#64748b;">Khách sạn sẽ hoàn tất tiếp nhận phòng và gửi thông báo xác nhận tới bạn sớm nhất.</p>
        </div>
        <div class="ftr">© 2026 Traveleke Inc. Mọi quyền được bảo lưu.</div>
      </div>
    </body>
    </html>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: `✅ [Traveleke] Thanh toán thành công đơn đặt phòng #${data.bookingCode}`,
        html: htmlContent,
      });
      return true;
    } catch (err: any) {
      this.logger.error(`Lỗi gửi mail thanh toán thành công: ${err.message}`);
      return false;
    }
  }

  /**
   * Section 38: Gửi email khi Lễ tân / Quản lý xác nhận booking (PENDING -> CONFIRMED)
   */
  async sendBookingConfirmedEmail(
    to: string,
    data: {
      bookingCode: string;
      contactName: string;
      hotelName?: string;
      checkInAt: Date | string;
    },
  ): Promise<boolean> {
    const from = this.configService.get<string>(
      'MAIL_FROM',
      '"Traveleke" <dangquangminhdn76@gmail.com>',
    );

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <body>
      <div style="max-width:600px; margin:20px auto; font-family:sans-serif; background:#fff; border-radius:12px; border:1px solid #e2e8f0; padding:24px;">
        <h2 style="color:#16a34a; margin-top:0;">🎉 Khách Sạn Đã Xác Nhận Đơn Đặt Phòng</h2>
        <p>Xin chào <strong>${data.contactName}</strong>,</p>
        <p>Đơn đặt phòng <strong>#${data.bookingCode}</strong> của bạn đã được khách sạn xác nhận giữ chỗ hoàn tất!</p>
        <p>Thời gian check-in: <strong>${new Date(data.checkInAt).toLocaleString('vi-VN')}</strong></p>
        <p>Chúc bạn có một chuyến đi tuyệt vời cùng Traveleke!</p>
      </div>
    </body>
    </html>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: `🎉 [Traveleke] Khách sạn đã xác nhận đơn #${data.bookingCode}`,
        html: htmlContent,
      });
      return true;
    } catch (err: any) {
      this.logger.error(`Lỗi gửi mail xác nhận booking: ${err.message}`);
      return false;
    }
  }

  /**
   * Gửi email thông báo đơn hết hạn thanh toán
   */
  async sendPaymentExpiredEmail(
    to: string,
    data: {
      bookingCode: string;
      contactName: string;
    },
  ): Promise<boolean> {
    const from = this.configService.get<string>(
      'MAIL_FROM',
      '"Traveleke" <dangquangminhdn76@gmail.com>',
    );

    const htmlContent = `
    <div style="font-family:sans-serif; padding:20px;">
      <h3>Đơn đặt phòng #${data.bookingCode} đã hết hạn thanh toán</h3>
      <p>Xin chào ${data.contactName}, đơn hàng #${data.bookingCode} đã hết thời gian thanh toán 15 phút. Nếu vẫn có nhu cầu đặt phòng, vui lòng truy cập Traveleke để tiến hành đặt lại.</p>
    </div>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: `⏰ [Traveleke] Đơn đặt phòng #${data.bookingCode} đã hết hạn thanh toán`,
        html: htmlContent,
      });
      return true;
    } catch (err: any) {
      return false;
    }
  }

  /**
   * Gửi email hoàn tiền thành công
   */
  async sendRefundSuccessEmail(
    to: string,
    data: {
      bookingCode: string;
      contactName: string;
      refundAmount: number | string;
    },
  ): Promise<boolean> {
    const from = this.configService.get<string>(
      'MAIL_FROM',
      '"Traveleke" <dangquangminhdn76@gmail.com>',
    );

    const htmlContent = `
    <div style="font-family:sans-serif; padding:20px;">
      <h3>Hoàn tiền thành công cho đơn đặt phòng #${data.bookingCode}</h3>
      <p>Xin chào ${data.contactName}, số tiền ${Number(data.refundAmount).toLocaleString('vi-VN')} VND đã được thực hiện lệnh hoàn tiền về phương thức thanh toán ban đầu của bạn.</p>
    </div>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: `💳 [Traveleke] Thông báo hoàn tiền cho đơn #${data.bookingCode}`,
        html: htmlContent,
      });
      return true;
    } catch (err: any) {
      return false;
    }
  }
}
