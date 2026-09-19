import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('home')
  getHomeData() {
    return {
      success: true,
      message: 'Traveleke API Homepage Data',
      timestamp: new Date().toISOString(),
      banners: [
        {
          id: 1,
          title: 'Săn Vé Máy Bay & Khách Sạn Cao Cấp',
          subtitle: 'Ưu đãi lên tới 40% cho thành viên Traveleke',
        },
      ],
    };
  }
}

