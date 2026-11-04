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

    return this.safeCompareHex(signed, String(secureHash));
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
      if (response && 'ok' in response && !response.ok) {
        throw new Error(`VNPay QueryDr HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data || !this.verifyQueryDrResponse(data)) {
        this.logger.error(
          `[QueryDr] Thiếu chữ ký hoặc sai lệch chữ ký phản hồi (Invalid Checksum) cho txnRef: ${params.txnRef}`,
        );
        throw new Error('Chữ ký phản hồi QueryDr từ VNPay thiếu hoặc không hợp lệ.');
      }
      if (data.vnp_TmnCode && vnpTmnCode && String(data.vnp_TmnCode) !== String(vnpTmnCode)) {
        throw new Error('Mã merchant (vnp_TmnCode) trong phản hồi QueryDr không khớp.');
      }
      if (data.vnp_TxnRef && String(data.vnp_TxnRef) !== String(vnpTxnRef)) {
        throw new Error('Mã giao dịch (vnp_TxnRef) trong phản hồi QueryDr không khớp.');
      }
      return data;
    } catch (err: any) {
      this.logger.error(`[QueryDr] Lỗi gọi API VNPay: ${err.message}`, err.stack);
      throw err;
    }
  }

  private safeCompareHex(expectedHex: string, actualHex: string): boolean {
    const a = Buffer.from(String(expectedHex || '').trim().toLowerCase(), 'utf-8');
    const b = Buffer.from(String(actualHex || '').trim().toLowerCase(), 'utf-8');
    if (a.length === 0 || a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Xác thực chữ ký phản hồi QueryDr từ VNPay 2.1.0
   */
  verifyQueryDrResponse(resData: Record<string, any>): boolean {
    if (!resData || !resData.vnp_SecureHash || !this.hashSecret) {
      return false;
    }
    const secureHash = String(resData.vnp_SecureHash).toLowerCase();
    const hashData = [
      resData.vnp_ResponseId || '',
      resData.vnp_Command || '',
      resData.vnp_ResponseCode || '',
      resData.vnp_Message || '',
      resData.vnp_TmnCode || '',
      resData.vnp_TxnRef || '',
      resData.vnp_Amount || '',
      resData.vnp_BankCode || '',
      resData.vnp_PayDate || '',
      resData.vnp_TransactionNo || '',
      resData.vnp_TransactionType || '',
      resData.vnp_TransactionStatus || '',
      resData.vnp_OrderInfo || '',
      resData.vnp_PromotionCode || '',
      resData.vnp_PromotionAmount || '',
    ].join('|');

    const hmac = crypto.createHmac('sha512', this.hashSecret);
    const signed = hmac.update(Buffer.from(hashData, 'utf-8')).digest('hex');
    return this.safeCompareHex(signed, secureHash);
  }

  /**
   * Xác thực chữ ký phản hồi Refund từ VNPay 2.1.0
   * S-02: Bắt buộc phải có vnp_SecureHash hợp lệ; thiếu chữ ký bị coi là dữ liệu không đáng tin.
   */
  verifyRefundResponse(resData: Record<string, any>): boolean {
    if (!resData || !resData.vnp_SecureHash || !this.hashSecret) {
      return false;
    }
    const secureHash = String(resData.vnp_SecureHash).toLowerCase();
    const hashData = [
      resData.vnp_ResponseId || '',
      resData.vnp_Command || '',
      resData.vnp_ResponseCode || '',
      resData.vnp_Message || '',
      resData.vnp_TmnCode || '',
      resData.vnp_TxnRef || '',
      resData.vnp_Amount || '',
      resData.vnp_BankCode || '',
      resData.vnp_PayDate || '',
      resData.vnp_TransactionNo || '',
      resData.vnp_TransactionType || '',
      resData.vnp_TransactionStatus || '',
      resData.vnp_OrderInfo || '',
    ].join('|');

    const hmac = crypto.createHmac('sha512', this.hashSecret);
    const signed = hmac.update(Buffer.from(hashData, 'utf-8')).digest('hex');
    return this.safeCompareHex(signed, secureHash);
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
    transactionType: '02' | '03'; // 02: Toan phan, 03: Mot phan
    requestId: string;
  }): Promise<any> {
    if (!params.requestId || !String(params.requestId).trim()) {
      throw new Error('Bắt buộc cung cấp requestId ổn định cho yêu cầu hoàn tiền VNPay.');
    }
    if (params.transactionType !== '02' && params.transactionType !== '03') {
      throw new Error(`Loại giao dịch hoàn tiền VNPay không hợp lệ: ${params.transactionType}`);
    }
    const stableSeed = crypto
      .createHash('sha256')
      .update(String(params.requestId).trim())
      .digest('hex')
      .slice(0, 24)
      .toUpperCase();
    const requestId = `REF_${stableSeed}`;
    const vnpVersion = '2.1.0';
    const vnpCommand = 'refund';
    const vnpTmnCode = this.tmnCode;
    const vnpTxnRef = params.txnRef;
    const vnpAmount = Math.round(params.amount * 100);
    const vnpOrderInfo = `Hoan tien giao dich ${vnpTxnRef}`;
    const vnpTransDate = this.formatDateGmt7(params.transactionDate);
    const vnpCreateDate = this.formatDateGmt7(new Date());
    const vnpIpAddr = params.ipAddr || '127.0.0.1';
    const vnpTransactionType = params.transactionType;
    const vnpTransactionNo = params.transactionNo || '';
    const vnpCreateBy = params.createBy || 'SYSTEM_REFUND_WORKER';

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
      if (response && 'ok' in response && !response.ok) {
        throw new Error(`VNPay Refund HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data || !this.verifyRefundResponse(data)) {
        this.logger.error(
          `[Refund] Thiếu chữ ký hoặc sai lệch chữ ký phản hồi Refund cho txnRef: ${params.txnRef}`,
        );
        throw new Error('Chữ ký phản hồi Refund từ VNPay thiếu hoặc không hợp lệ.');
      }
      if (data.vnp_TmnCode && vnpTmnCode && String(data.vnp_TmnCode) !== String(vnpTmnCode)) {
        throw new Error('Mã merchant (vnp_TmnCode) trong phản hồi Refund không khớp.');
      }
      if (data.vnp_TxnRef && String(data.vnp_TxnRef) !== String(vnpTxnRef)) {
        throw new Error('Mã giao dịch (vnp_TxnRef) trong phản hồi Refund không khớp.');
      }
      if (data.vnp_TransactionType && String(data.vnp_TransactionType) !== String(vnpTransactionType)) {
        throw new Error('Loại hoàn tiền (vnp_TransactionType) trong phản hồi không khớp.');
      }
      if (data.vnp_Amount !== undefined && Number(data.vnp_Amount) !== vnpAmount) {
        this.logger.error(
          `[Refund] Số tiền phản hồi (${data.vnp_Amount}) không khớp yêu cầu (${vnpAmount}) cho txnRef: ${params.txnRef}`,
        );
        throw new Error('Số tiền phản hồi Refund từ VNPay không khớp với yêu cầu.');
      }
      return data;
    } catch (err: any) {
      this.logger.error(`[Refund] Lỗi gọi API VNPay Refund: ${err.message}`, err.stack);
      throw err;
    }
  }
}
