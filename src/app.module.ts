import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppWorker } from './app.worker';
import { AppMapper } from './app.mapper';
import { DomainModule } from '@app/domain';
import { RabbitMqModule } from '@app/rabbit-mq';
import { WorkflowModule } from '../libs/workflow';
import { MongodbModule } from '@app/mongodb';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DomainModule,
    RabbitMqModule,
    WorkflowModule,
    MongodbModule,
    MongooseModule.forRoot(process.env.DB_CONNECTION_STRING, {
      dbName: process.env.DB_NAME,
    }),
  ],
  controllers: [AppController],
  providers: [AppService, AppWorker, AppMapper],
})
export class AppModule {}
