import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Bật debug logger nếu cấu hình OTEL_DEBUG=true
if (process.env.OTEL_DEBUG === 'true') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

/**
 * Phân tích cú pháp headers cấu hình từ chuỗi (ví dụ: "Authorization=Bearer xxx,X-Header=yyy")
 */
function parseHeaders(rawHeaders?: string): Record<string, string> | undefined {
  if (!rawHeaders) return undefined;
  const headers: Record<string, string> = {};
  rawHeaders.split(',').forEach((pair) => {
    const [key, ...vals] = pair.split('=');
    if (key && vals.length > 0) {
      headers[key.trim()] = vals.join('=').trim();
    }
  });
  return Object.keys(headers).length > 0 ? headers : undefined;
}

// Khởi tạo Exporter gửi trace tới Elastic APM / OTel Collector
const traceExporter = new OTLPTraceExporter({
  url:
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    'http://localhost:8200/v1/traces',
  headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  timeoutMillis: 3000,
});

/**
 * Khởi tạo OpenTelemetry NodeSDK với Auto-Instrumentation
 * Chú ý: File này PHẢI được import đầu tiên trong main.ts trước khi NestJS load
 */
export const otelSdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME || 'traveleke-backend',
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Tắt instrumentation cho fs để tránh tạo quá nhiều span đọc ghi file tĩnh
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
    }),
  ],
});

try {
  otelSdk.start();
} catch (error: any) {
  // RESILIENT PATTERN: Nếu OTel gặp trục trặc khởi động, không bao giờ làm crash ứng dụng
  console.warn('[OpenTelemetry] Khởi tạo gặp lỗi (chế độ dự phòng):', error?.message || error);
}

// Graceful Shutdown khi nhận tín hiệu kết thúc từ OS / Container runtime
const handleShutdown = async (signal: string) => {
  try {
    await otelSdk.shutdown();
  } catch (error: any) {
    // ignore
  } finally {
    process.exit(0);
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
