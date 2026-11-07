import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PaymentTransaction,
  PaymentTransactionStatus,
} from '../entities/payment-transaction.entity';
import { VnpayService } from '../vnpay.service';

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);
  private readonly verifiedOutcomes = new Map<
    string,
    {
      success: boolean;
      data?: any;
      error?: string;
      outcomeStatus?:
        | 'SIMULATED_SUCCEEDED'
        | 'SANDBOX_ACCEPTED'
        | 'SANDBOX_SETTLED'
        | 'MANUAL_TEST_VERIFIED'
        | 'FAILED'
        | 'UNKNOWN_RECONCILE';
      providerRef?: string;
      isSimulated?: boolean;
    }
  >();

  constructor(
    private readonly dataSource: DataSource,
    private readonly vnpayService: VnpayService,
  ) {}

  getProviderMode(): 'MOCK' | 'VNPAY_SANDBOX' | 'MANUAL_TEST' {
    const raw = (process.env.REFUND_PROVIDER || 'MOCK').toUpperCase();
    if (raw === 'VNPAY_SANDBOX' || raw === 'MANUAL_TEST') return raw;
    return 'MOCK';
  }

  getVerifiedOutcome(requestKey: string) {
    return this.verifiedOutcomes.get(requestKey) || null;
  }

  private async loadPersistedOutcome(mode: string, requestKey: string) {
    const cached =
      this.verifiedOutcomes.get(`${mode}:${requestKey}`) ||
      this.verifiedOutcomes.get(requestKey);
    if (cached) return cached;
    if (typeof this.dataSource?.query === 'function') {
      try {
        const rows = await this.dataSource.query(
          `SELECT outcome_status AS outcomeStatus, provider_ref AS providerRef,
                  is_simulated AS isSimulated, error_message AS errorMessage,
                  payload_json AS payloadJson
           FROM payment_refund_outcomes
           WHERE request_key = ? AND provider_mode = ?
           LIMIT 1`,
          [requestKey, mode],
        );
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          const restored = {
            success:
              row.outcomeStatus !== 'FAILED' &&
              row.outcomeStatus !== 'UNKNOWN_RECONCILE',
            outcomeStatus: row.outcomeStatus,
            providerRef: row.providerRef || undefined,
            isSimulated: Boolean(Number(row.isSimulated)),
            error: row.errorMessage || undefined,
            data:
              typeof row.payloadJson === 'string'
                ? (() => {
                    try {
                      return JSON.parse(row.payloadJson);
                    } catch {
                      return undefined;
                    }
                  })()
                : row.payloadJson,
          };
          this.verifiedOutcomes.set(`${mode}:${requestKey}`, restored);
          this.verifiedOutcomes.set(requestKey, restored);
          return restored;
        }
      } catch {
        // Bảng có thể chưa khởi tạo ở môi trường mock thuần
      }
    }
    return null;
  }

  private async rememberOutcome(
    requestKey: string,
    mode: string,
    outcome: {
      success: boolean;
      data?: any;
      error?: string;
      outcomeStatus?:
        | 'SIMULATED_SUCCEEDED'
        | 'SANDBOX_ACCEPTED'
        | 'SANDBOX_SETTLED'
        | 'MANUAL_TEST_VERIFIED'
        | 'FAILED'
        | 'UNKNOWN_RECONCILE';
      providerRef?: string;
      isSimulated?: boolean;
    },
  ) {
    this.verifiedOutcomes.set(`${mode}:${requestKey}`, outcome);
    this.verifiedOutcomes.set(requestKey, outcome);
    if (typeof this.dataSource?.query === 'function') {
      try {
        await this.dataSource.query(`
          CREATE TABLE IF NOT EXISTS payment_refund_outcomes (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            request_key VARCHAR(160) NOT NULL,
            provider_mode VARCHAR(40) NOT NULL,
            outcome_status VARCHAR(40) NOT NULL,
            provider_ref VARCHAR(160) NULL,
            is_simulated TINYINT(1) NOT NULL DEFAULT 0,
            error_message TEXT NULL,
            payload_json JSON NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_refund_outcome_key (request_key, provider_mode)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        await this.dataSource.query(
          `INSERT INTO payment_refund_outcomes (
             request_key, provider_mode, outcome_status, provider_ref,
             is_simulated, error_message, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             outcome_status = VALUES(outcome_status),
             provider_ref = VALUES(provider_ref),
             error_message = VALUES(error_message),
             payload_json = VALUES(payload_json)`,
          [
            requestKey,
            mode,
            outcome.outcomeStatus || (outcome.success ? 'SANDBOX_SETTLED' : 'FAILED'),
            outcome.providerRef || null,
            outcome.isSimulated ? 1 : 0,
            outcome.error || null,
            outcome.data ? JSON.stringify(outcome.data) : null,
          ],
        );
      } catch {
        // Fallback giữ trong RAM nếu mock query không hỗ trợ DDL
      }
    }
    return outcome;
  }

  /**
   * Xử lý gọi Refund Adapter theo cấu hình deployment (MOCK | VNPAY_SANDBOX | MANUAL_TEST)
   */
  async processRefund(params: {
    paymentId?: string;
    txnRef: string;
    amount: number;
    transactionNo?: string;
    transactionDate?: Date | string;
    createBy?: string;
    reason?: string;
    idempotencyKey?: string;
    channel?: 'VNPAY_PROVIDER' | 'BANK_TRANSFER_PROOF' | 'CASH_RECEIPT';
    payoutReceiptRef?: string;
    isPromotionPartialRefund?: boolean;
  }): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    outcomeStatus?:
      | 'SIMULATED_SUCCEEDED'
      | 'SANDBOX_ACCEPTED'
      | 'SANDBOX_SETTLED'
      | 'MANUAL_TEST_VERIFIED'
      | 'FAILED'
      | 'UNKNOWN_RECONCILE';
    providerRef?: string;
    isSimulated?: boolean;
  }> {
    const mode =
      params.channel && params.channel !== 'VNPAY_PROVIDER'
        ? 'MANUAL_TEST'
        : this.getProviderMode();
    const requestKey = params.idempotencyKey || `${params.txnRef}:${Math.round(Number(params.amount || 0))}`;

    // FIX-03 & E14 (LOW-02): Kiểm tra kết quả đã lưu trong RAM hoặc DB (payment_refund_outcomes)
    // để không gọi lại VNPay Refund sau khi server restart nếu đang ở trạng thái UNKNOWN_RECONCILE hoặc đã thành công.
    const cachedOutcome = await this.loadPersistedOutcome(mode, requestKey);
    if (cachedOutcome && (cachedOutcome.success || cachedOutcome.outcomeStatus === 'UNKNOWN_RECONCILE')) {
      this.logger.log(
        `[RefundService] Tái sử dụng kết quả Refund đã xác minh cho idempotencyKey=${requestKey} (${cachedOutcome.outcomeStatus}), không gọi lại provider.`,
      );
      return cachedOutcome;
    }

    this.logger.log(
      `[RefundService] Bắt đầu gọi Refund Adapter [mode=${mode}] cho txnRef ${params.txnRef}, số tiền: ${params.amount}`,
    );

    const paymentRepo = this.dataSource.getRepository(PaymentTransaction);

    let payment: PaymentTransaction | null = null;
    if (params.paymentId) {
      payment = await paymentRepo.findOne({ where: { id: params.paymentId } });
    } else if (params.txnRef) {
      payment = await paymentRepo.findOne({ where: { txnRef: params.txnRef } });
    }

    const paidTotal = payment ? Number(payment.amount || 0) : Number(params.amount || 0);
    const prevRefunded = payment ? Number(payment.refundAmount || 0) : 0;
    const maxRemainingRefundable = Math.max(0, paidTotal - prevRefunded);
    const effectiveRefundAmount =
      paidTotal > 0 ? Math.min(Number(params.amount || 0), maxRemainingRefundable) : Number(params.amount || 0);

    if (payment && effectiveRefundAmount <= 0) {
      this.logger.warn(
        `[RefundService] Giao dịch ${params.txnRef} đã hoàn đủ (${prevRefunded}/${paidTotal}), bỏ qua hoàn trùng.`,
      );
      return {
        success: true,
        outcomeStatus: mode === 'MOCK' ? 'SIMULATED_SUCCEEDED' : 'SANDBOX_SETTLED',
        data: { vnp_ResponseCode: '00', alreadyRefunded: true },
        isSimulated: true,
      };
    }

    if (mode === 'MOCK' && params.isPromotionPartialRefund) {
      const simRef = `TEST-SIM-${requestKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(-24)}`;
      return this.rememberOutcome(requestKey, mode, {
        success: true,
        outcomeStatus: 'SIMULATED_SUCCEEDED',
        providerRef: simRef,
        isSimulated: true,
        data: { providerRef: simRef, providerMode: 'MOCK', simulated: true },
      });
    }

    if (mode === 'MANUAL_TEST' && params.isPromotionPartialRefund) {
      if (!params.payoutReceiptRef || !params.payoutReceiptRef.trim()) {
        return {
          success: false,
          outcomeStatus: 'FAILED',
          error: 'Hoàn tiền thủ công bắt buộc có mã chứng từ chi (payoutReceiptRef).',
        };
      }
      const manualRef = `TEST-MANUAL-${params.payoutReceiptRef.trim()}`;
      return this.rememberOutcome(requestKey, mode, {
        success: true,
        outcomeStatus: 'MANUAL_TEST_VERIFIED',
        providerRef: manualRef,
        isSimulated: true,
        data: { providerMode: 'MANUAL_TEST', payoutReceiptRef: params.payoutReceiptRef.trim(), simulated: true },
      });
    }

    if (params.isPromotionPartialRefund && !payment) {
      return {
        success: false,
        outcomeStatus: 'FAILED',
        error: 'Không tìm thấy giao dịch thanh toán gốc (PAID) để đối chiếu hoàn một phần.',
      };
    }

    const tDate = params.transactionDate
      ? new Date(params.transactionDate)
      : payment?.payDate || payment?.paidAt || new Date();

    // S-01: Hoàn một phần (160k trên 5M) BẮT BUỘC dùng '03', chỉ '02' khi hoàn toàn bộ
    const transactionType: '02' | '03' =
      paidTotal > 0 && (effectiveRefundAmount < paidTotal || prevRefunded > 0) ? '03' : '02';

    let refundRes: any;
    try {
      refundRes = await this.vnpayService.refund({
        txnRef: params.txnRef,
        amount: effectiveRefundAmount,
        transactionNo: params.transactionNo || payment?.vnpTransactionNo || '0',
        transactionDate: tDate,
        createBy: params.createBy || 'SYSTEM_REFUND_WORKER',
        transactionType,
        requestId: requestKey,
      });
    } catch (err: any) {
      this.logger.error(`[RefundService] Lỗi mạng/chữ ký khi gọi VNPay Refund cho ${params.txnRef}: ${err.message}`);
      return this.rememberOutcome(requestKey, mode, {
        success: false,
        outcomeStatus: 'UNKNOWN_RECONCILE',
        error: err.message || 'Lỗi kết nối cổng hoàn tiền VNPay; cần đối soát trước khi thử lại.',
      });
    }

    if (refundRes?.vnp_ResponseCode === '00') {
      const txStatus = String(refundRes?.vnp_TransactionStatus || '00');
      const isPendingAtBank = txStatus === '01' || txStatus === '05' || txStatus === '06';
      const outcomeStatus = isPendingAtBank ? 'SANDBOX_ACCEPTED' : 'SANDBOX_SETTLED';

      if (payment && !isPendingAtBank) {
        if (typeof this.dataSource?.transaction === 'function') {
          await this.dataSource.transaction(async (em) => {
            const lockedPayment = await em.findOne(PaymentTransaction, {
              where: { id: payment!.id },
              lock: { mode: 'pessimistic_write' },
            });
            if (!lockedPayment) return;
            const curRefunded = Number(lockedPayment.refundAmount || 0);
            const newTotalRefunded = Math.min(paidTotal, curRefunded + effectiveRefundAmount);
            if (paidTotal > 0 && newTotalRefunded >= paidTotal) {
              lockedPayment.status = PaymentTransactionStatus.REFUNDED;
            }
            lockedPayment.refundAmount = newTotalRefunded.toFixed(2);
            lockedPayment.refundedAt = new Date();
            lockedPayment.refundNote = params.reason || `VNPay Sandbox Refund (${transactionType}) [${outcomeStatus}]`;
            await em.save(PaymentTransaction, lockedPayment);
          });
        } else {
          const newTotalRefunded = prevRefunded + effectiveRefundAmount;
          if (paidTotal > 0 && newTotalRefunded >= paidTotal) {
            payment.status = PaymentTransactionStatus.REFUNDED;
          }
          payment.refundAmount = newTotalRefunded.toFixed(2);
          payment.refundedAt = new Date();
          payment.refundNote = params.reason || `VNPay Sandbox Refund (${transactionType}) [${outcomeStatus}]`;
          await paymentRepo.save(payment);
        }
      }

      if (!refundRes?.vnp_TransactionNo) {
        return this.rememberOutcome(requestKey, mode, {
          success: true,
          outcomeStatus: 'SANDBOX_ACCEPTED',
          providerRef: undefined,
          isSimulated: true,
          data: refundRes,
        });
      }

      this.logger.log(
        `[RefundService] VNPay Refund (${transactionType}) -> ${outcomeStatus} cho ${params.txnRef}`,
      );
      return this.rememberOutcome(requestKey, mode, {
        success: true,
        outcomeStatus,
        providerRef: String(refundRes.vnp_TransactionNo),
        isSimulated: true,
        data: refundRes,
      });
    } else {
      this.logger.error(
        `[RefundService] VNPay Refund thất bại cho ${params.txnRef}: ${refundRes?.vnp_Message || refundRes?.vnp_ResponseCode}`,
      );
      return {
        success: false,
        outcomeStatus: 'FAILED',
        error: refundRes?.vnp_Message || `Response code: ${refundRes?.vnp_ResponseCode}`,
      };
    }
  }
}
