import { IsNotEmpty, IsString, IsISO8601, IsOptional } from 'class-validator';

export class LateArrivalNoticeDto {
  @IsNotEmpty({ message: 'Thời gian dự kiến đến không được để trống' })
  @IsISO8601({}, { message: 'Thời gian dự kiến đến phải có định dạng ISO 8601 hợp lệ' })
  expectedArrivalAt!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
