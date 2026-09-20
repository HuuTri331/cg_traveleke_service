import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceCategory } from './entities/service-category.entity';
import { RoomService } from './entities/room-service.entity';
import { ServiceRequest } from './entities/service-request.entity';
import {
  CreateServiceCategoryDto,
  UpdateServiceCategoryDto,
  CreateRoomServiceDto,
  UpdateRoomServiceDto,
  CreateServiceRequestDto,
  UpdateServiceRequestDto,
} from './dto/services.dto';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly categoryRepo: Repository<ServiceCategory>,

    @InjectRepository(RoomService)
    private readonly roomServiceRepo: Repository<RoomService>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,
  ) {}

  // ============================================================
  // SERVICE CATEGORIES
  // ============================================================

  async getAllCategories(includeInactive = false): Promise<ServiceCategory[]> {
    const where = includeInactive ? {} : { status: 'ACTIVE' as const };
    return this.categoryRepo.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
      relations: ['services'],
    });
  }

  async getCategoryById(id: number): Promise<ServiceCategory> {
    const cat = await this.categoryRepo.findOne({
      where: { id },
      relations: ['services'],
    });
    if (!cat) throw new NotFoundException(`Danh mục dịch vụ #${id} không tồn tại`);
    return cat;
  }

  async createCategory(dto: CreateServiceCategoryDto): Promise<ServiceCategory> {
    const cat = this.categoryRepo.create({
      code: dto.code.toUpperCase().replace(/\s+/g, '_'),
      name: dto.name,
      description: dto.description,
      icon: dto.icon,
      sortOrder: dto.sortOrder ?? 0,
      status: 'ACTIVE',
    });
    return this.categoryRepo.save(cat);
  }

  async updateCategory(id: number, dto: UpdateServiceCategoryDto): Promise<ServiceCategory> {
    const cat = await this.getCategoryById(id);
    Object.assign(cat, dto);
    return this.categoryRepo.save(cat);
  }

  async deleteCategory(id: number): Promise<{ message: string }> {
    const cat = await this.getCategoryById(id);
    await this.categoryRepo.remove(cat);
    return { message: `Đã xoá danh mục "${cat.name}"` };
  }

  // ============================================================
  // ROOM SERVICES
  // ============================================================

  async getAllRoomServices(hotelId?: number, categoryId?: number): Promise<RoomService[]> {
    const qb = this.roomServiceRepo.createQueryBuilder('rs')
      .leftJoinAndSelect('rs.category', 'cat')
      .where('rs.status = :status', { status: 'ACTIVE' });

    if (hotelId) {
      qb.andWhere('(rs.hotelId = :hotelId OR rs.hotelId IS NULL)', { hotelId });
    }
    if (categoryId) {
      qb.andWhere('rs.categoryId = :categoryId', { categoryId });
    }

    return qb.orderBy('cat.sortOrder', 'ASC').addOrderBy('rs.name', 'ASC').getMany();
  }

  async getRoomServiceById(id: number): Promise<RoomService> {
    const svc = await this.roomServiceRepo.findOne({
      where: { id },
      relations: ['category'],
    });
    if (!svc) throw new NotFoundException(`Dịch vụ #${id} không tồn tại`);
    return svc;
  }

  async createRoomService(dto: CreateRoomServiceDto): Promise<RoomService> {
    const svc = this.roomServiceRepo.create({
      categoryId: dto.categoryId,
      hotelId: dto.hotelId ?? null,
      roomTypeId: dto.roomTypeId ?? null,
      name: dto.name,
      description: dto.description,
      unit: dto.unit ?? 'lần',
      basePrice: dto.basePrice ?? 0,
      isComplimentary: dto.isComplimentary ?? false,
      maxQuantity: dto.maxQuantity ?? null,
      status: 'ACTIVE',
    });
    return this.roomServiceRepo.save(svc);
  }

  async updateRoomService(id: number, dto: UpdateRoomServiceDto): Promise<RoomService> {
    const svc = await this.getRoomServiceById(id);
    Object.assign(svc, dto);
    return this.roomServiceRepo.save(svc);
  }

  async deleteRoomService(id: number): Promise<{ message: string }> {
    const svc = await this.getRoomServiceById(id);
    await this.roomServiceRepo.remove(svc);
    return { message: `Đã xoá dịch vụ "${svc.name}"` };
  }

  // ============================================================
  // SERVICE REQUESTS
  // ============================================================

  async getServiceRequestsByBooking(bookingId: number): Promise<ServiceRequest[]> {
    return this.serviceRequestRepo.find({
      where: { bookingId },
      relations: ['service', 'service.category'],
      order: { createdAt: 'DESC' },
    });
  }

  async getAllServiceRequests(filters?: {
    status?: string;
    assignedTo?: number;
    hotelId?: number;
  }): Promise<ServiceRequest[]> {
    const qb = this.serviceRequestRepo.createQueryBuilder('sr')
      .leftJoinAndSelect('sr.service', 'svc')
      .leftJoinAndSelect('svc.category', 'cat');

    if (filters?.status) {
      qb.andWhere('sr.status = :status', { status: filters.status });
    }
    if (filters?.assignedTo) {
      qb.andWhere('sr.assignedTo = :assignedTo', { assignedTo: filters.assignedTo });
    }

    return qb.orderBy('sr.createdAt', 'DESC').getMany();
  }

  async createServiceRequest(dto: CreateServiceRequestDto): Promise<ServiceRequest> {
    const service = await this.getRoomServiceById(dto.serviceId);
    const quantity = dto.quantity ?? 1;
    const totalPrice = service.isComplimentary ? 0 : Number(service.basePrice) * quantity;

    const req = this.serviceRequestRepo.create({
      bookingId: dto.bookingId,
      serviceId: dto.serviceId,
      serviceName: service.name,
      unitPrice: service.basePrice,
      quantity,
      totalPrice,
      note: dto.note,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      status: 'PENDING',
    });
    return this.serviceRequestRepo.save(req);
  }

  async updateServiceRequest(id: number, dto: UpdateServiceRequestDto): Promise<ServiceRequest> {
    const req = await this.serviceRequestRepo.findOne({ where: { id } });
    if (!req) throw new NotFoundException(`Yêu cầu dịch vụ #${id} không tồn tại`);

    if (dto.status) req.status = dto.status as ServiceRequest['status'];
    if (dto.assignedTo !== undefined) req.assignedTo = dto.assignedTo;
    if (dto.note !== undefined) req.note = dto.note;
    if (dto.completedAt) req.completedAt = new Date(dto.completedAt);

    return this.serviceRequestRepo.save(req);
  }

  // ============================================================
  // STATISTICS
  // ============================================================

  async getServiceStats(): Promise<{
    totalCategories: number;
    totalServices: number;
    totalRequests: number;
    pendingRequests: number;
    completedRequests: number;
  }> {
    const [totalCategories, totalServices, totalRequests, pendingRequests, completedRequests] =
      await Promise.all([
        this.categoryRepo.count({ where: { status: 'ACTIVE' } }),
        this.roomServiceRepo.count({ where: { status: 'ACTIVE' } }),
        this.serviceRequestRepo.count(),
        this.serviceRequestRepo.count({ where: { status: 'PENDING' } }),
        this.serviceRequestRepo.count({ where: { status: 'COMPLETED' } }),
      ]);

    return { totalCategories, totalServices, totalRequests, pendingRequests, completedRequests };
  }
}
