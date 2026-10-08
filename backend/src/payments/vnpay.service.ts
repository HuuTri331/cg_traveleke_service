import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class VnpayService {
  private readonly logger = new Logger(VnpayService.name);

  constructor(private readonly configService: ConfigService) {}

  private get tmnCode(): string {
    return this.configService.get<string>('VNPAY_TMN_CODE') || '';
  }

  private get hashSecret(): string {
    return this.configService.get<string>('VNPAY_HASH_SECRET') || '';
  }

  private get paymentUrl(): string {
    return (
      this.configService.get<string>('VNPAY_URL') ||
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'
    );
  }

  private get apiUrl(): string {
    return (
      this.configService.get<string>('VNPAY_API_URL') ||
      'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'
    );
  }

  private get returnUrl(): string {
    return (
      this.configService.get<string>('VNPAY_RETURN_URL') ||
      'http://localhost:3000/payment/vnpay/result'
    );
  }

  /**
   * Định dạng Date theo GMT+7 YYYYMMDDHHmmss chuẩn VNPay
   */
  formatDateGmt7(date: Date): string {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    const gmt7 = new Date(utc + 7 * 3600000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const yyyy = gmt7.getFullYear();
    const mm = pad(gmt7.getMonth() + 1);
    const dd = pad(gmt7.getDate());
    const hh = pad(gmt7.getHours());
    const min = pad(gmt7.getMinutes());
    const ss = pad(gmt7.getSeconds());
    return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
  }

  /**
   * Sort object keys alphabetically for hashing
   */
  private sortObject(obj: Record<string, any>): Record<string, string> {
    const sorted: Record<string, string> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      if (
        obj[key] !== '' &&
        obj[key] !== null &&
        obj[key] !== undefined
      ) {
        // VNPay nodejs sample standard: URI encode and replace %20 with +
        sorted[key] = encodeURIComponent(String(obj[key])).replace(/%20/g, '+');
      }
    }
    return sorted;
  }

  /**
   * Tạo URL thanh toán VNPay
   */
  buildPaymentUrl(params: {
    txnRef: string;
    amount: number;
    orderInfo: string;
    ipAddr?: string;
    cutoffMinutes?: number;
    createDate?: Date;
  }): { paymentUrl: string; paymentCutoffAt: Date; createDate: Date } {
    const createDate = params.createDate || new Date();
    // Section 13: Customer payment cutoff = 13 phút 55 giây (835 giây)
    const PAYMENT_CUTOFF_SECONDS = 13 * 60 + 55; // 835
    const cutoffSeconds = params.cutoffMinutes ? Math.floor(params.cutoffMinutes * 60) : PAYMENT_CUTOFF_SECONDS;
    const paymentCutoffAt = new Date(createDate.getTime() + cutoffSeconds * 1000);

    const vnpCreateDate = this.formatDateGmt7(createDate);
    const vnpExpireDate = this.formatDateGmt7(paymentCutoffAt);

    const vnpParams: Record<string, any> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: this.tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: params.txnRef,
      vnp_OrderInfo: params.orderInfo,
      vnp_OrderType: 'other',
      vnp_Amount: Math.round(params.amount * 100),
      vnp_ReturnUrl: this.returnUrl,
      vnp_IpAddr: params.ipAddr || '127.0.0.1',
      vnp_CreateDate: vnpCreateDate,
      vnp_ExpireDate: vnpExpireDate,
    };

    const sorted = this.sortObject(vnpParams);
    const signData = Object.entries(sorted)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const hmac = crypto.createHmac('sha512', this.hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    const finalUrl = `${this.paymentUrl}?${signData}&vnp_SecureHash=${signed}`;

    return {
      paymentUrl: finalUrl,
      paymentCutoffAt,
      createDate,
    };
  }

  /**
   * Xác thực chữ ký HMAC-SHA512 từ VNPay callback / IPN
   */
  verifySignature(vnpParams: Record<string, any>): boolean {
    const params = { ...vnpParams };
    const secureHash = params['vnp_SecureHash'];
    delete params['vnp_SecureHash'];
    delete params['vnp_SecureHashType'];

    const sorted = this.sortObject(params);
    const signData = Object.entries(sorted)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const hmac = crypto.createHmac('sha512', this.hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    return (
      String(secureHash).toLowerCase() === String(signed).toLowerCase()
    );
  }

  /**
   * Truy vấn trạng thái giao dịch thật tại VNPay (QueryDr)
   */
  async queryDr(params: {
    txnRef: string;
    transactionDate: Date;
    ipAddr?: string;
  }): Promise<any> {
    const requestId = `QDR_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const vnpVersion = '2.1.0';
    const vnpCommand = 'querydr';
    const vnpTmnCode = this.tmnCode;
    const vnpTxnRef = params.txnRef;
    const vnpTransDate = this.formatDateGmt7(params.transactionDate);
    const vnpCreateDate = this.formatDateGmt7(new Date());
    const vnpIpAddr = params.ipAddr || '127.0.0.1';
    const vnpOrderInfo = `Truy van trang thai giao dich ${vnpTxnRef}`;

    // QueryDr hash raw string format:
    // vnp_RequestId|vnp_Version|vnp_Command|vnp_TmnCode|vnp_TxnRef|vnp_TransactionDate|vnp_CreateDate|vnp_IpAddr|vnp_OrderInfo
    const hashData = [
      requestId,
      vnpVersion,
      vnpCommand,
      vnpTmnCode,
      vnpTxnRef,
      vnpTransDate,
      vnpCreateDate,
      vnpIpAddr,
      vnpOrderInfo,
    ].join('|');

    const hmac = crypto.createHmac('sha512', this.hashSecret);
    const secureHash = hmac.update(Buffer.from(hashData, 'utf-8')).digest('hex');

    const requestBody = {
      vnp_RequestId: requestId,
      vnp_Version: vnpVersion,
      vnp_Command: vnpCommand,
      vnp_TmnCode: vnpTmnCode,
      vnp_TxnRef: vnpTxnRef,
      vnp_OrderInfo: vnpOrderInfo,
      vnp_TransactionDate: vnpTransDate,
      vnp_CreateDate: vnpCreateDate,
      vnp_IpAddr: vnpIpAddr,
      vnp_SecureHash: secureHash,
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      return await response.json();
    } catch (err: any) {
      this.logger.error(`[QueryDr] Lỗi gọi API VNPay: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Gọi hoàn tiền VNPay (Refund)
   */
  async refund(params: {
    txnRef: string;
    amount: number;
    transactionNo: string;
    transactionDate: Date;
    createBy: string;
    ipAddr?: string;
    transactionType?: string; // 02: Toan phan, 03: Mot phan
  }): Promise<any> {
    const requestId = `REF_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const vnpVersion = '2.1.0';
    const vnpCommand = 'refund';
    const vnpTmnCode = this.tmnCode;
    const vnpTxnRef = params.txnRef;
    const vnpAmount = Math.round(params.amount * 100);
    const vnpOrderInfo = `Hoan tien giao dich ${vnpTxnRef}`;
    const vnpTransDate = this.formatDateGmt7(params.transactionDate);
    const vnpCreateDate = this.formatDateGmt7(new Date());
    const vnpIpAddr = params.ipAddr || '127.0.0.1';
    const vnpTransactionType = params.transactionType || '02';
    const vnpTransactionNo = params.transactionNo || '';
    const vnpCreateBy = params.createBy || 'TravelekeAdmin';

    // Refund hash raw string format:
    // vnp_RequestId|vnp_Version|vnp_Command|vnp_TmnCode|vnp_TransactionType|vnp_TxnRef|vnp_Amount|vnp_TransactionNo|vnp_TransactionDate|vnp_CreateBy|vnp_CreateDate|vnp_IpAddr|vnp_OrderInfo
    const hashData = [
      requestId,
      vnpVersion,
      vnpCommand,
      vnpTmnCode,
      vnpTransactionType,
      vnpTxnRef,
      vnpAmount,
      vnpTransactionNo,
      vnpTransDate,
      vnpCreateBy,
      vnpCreateDate,
      vnpIpAddr,
      vnpOrderInfo,
    ].join('|');

    const hmac = crypto.createHmac('sha512', this.hashSecret);
    const secureHash = hmac.update(Buffer.from(hashData, 'utf-8')).digest('hex');

    const requestBody = {
      vnp_RequestId: requestId,
      vnp_Version: vnpVersion,
      vnp_Command: vnpCommand,
      vnp_TmnCode: vnpTmnCode,
      vnp_TransactionType: vnpTransactionType,
      vnp_TxnRef: vnpTxnRef,
      vnp_Amount: vnpAmount,
      vnp_OrderInfo: vnpOrderInfo,
      vnp_TransactionNo: vnpTransactionNo,
      vnp_TransactionDate: vnpTransDate,
      vnp_CreateBy: vnpCreateBy,
      vnp_CreateDate: vnpCreateDate,
      vnp_IpAddr: vnpIpAddr,
      vnp_SecureHash: secureHash,
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      return await response.json();
    } catch (err: any) {
      this.logger.error(`[Refund] Lỗi gọi API VNPay Refund: ${err.message}`, err.stack);
      throw err;
    }
  }
}
