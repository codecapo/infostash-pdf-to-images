import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppService } from './app.service';
import { RabbitMqService } from '@app/rabbit-mq';
import { MongodbService } from '@app/mongodb';
import { AppMapper } from './app.mapper';
import { TaskProcessingRepo } from '../libs/workflow/repo/task-processing.repo';
import { AppTaskProcessingMessage } from './app.task-processing.message';
import { WorkflowProcessingLogRepo } from '../libs/workflow/repo/workflow-processing-log.repo';
import { ClientSession } from 'mongoose';
import { PdfToImagesTaskCompleted } from '../libs/workflow/pdf-to-images.task.completed';
import { InfostashArtefactRepo } from '../libs/domain/infostash-artefact.repo';

@Injectable()
export class AppWorker implements OnModuleInit {
  private readonly logger: Logger = new Logger(AppWorker.name);
  private readonly taskQueueName: string = process.env.QN_PDF_TO_IMAGES_TASK;

  constructor(
    private readonly appMapper: AppMapper,
    private readonly appService: AppService,
    private readonly rabbitMqService: RabbitMqService,
    private readonly mongodbService: MongodbService,
    private readonly taskProcessingRepo: TaskProcessingRepo,
    private readonly infostashArtefactRepo: InfostashArtefactRepo,
    private readonly workflowProcessingLogRepo: WorkflowProcessingLogRepo,
  ) {}

  async onModuleInit() {
    await this.setupMessageConsumer();
  }

  private async setupMessageConsumer() {
    try {
      await this.rabbitMqService.consumeMessages(
        this.taskQueueName,
        this.handleMessage.bind(this),
      );
      this.logger.debug(
        `Started consuming messages from queue: ${this.taskQueueName}`,
      );
    } catch (error) {
      this.logger.error(`Failed to set up message consumer: ${error}`);
    }
  }

  private async handleMessage(msg: any, ack: () => void) {
    if (!msg) return;

    let clientSession: ClientSession | null = null;

    try {
      const task = this.appMapper.mapAppTaskProcessingMessage(
        msg.content.toString(),
      );

      const mongoConnectionInstance =
        await this.mongodbService.mongoConnection();
      clientSession = await mongoConnectionInstance.startSession();
      clientSession.startTransaction();

      if (await this.isTaskAlreadyStarted(task.taskProcessingId)) {
        this.logger.debug(`Skip processing task ${task.taskProcessingId}`);
        await clientSession.commitTransaction();
        ack();
        return;
      }

      task.type = 'ACK';
      await this.sendReplyMessage(task);
      await this.startTaskProcessing(task.taskProcessingId);

      const taskProcessed = await this.processTask(task);

      await this.delay(1000);

      if (taskProcessed) {
        await this.completeTaskProcessing(
          task,
          taskProcessed.tmpImageDirectoryLocation,
        );
      }

      await clientSession.commitTransaction();
      ack();
    } catch (error) {
      this.logger.error(`Error processing task: ${error}`);
      if (clientSession) {
        try {
          await clientSession.abortTransaction();
        } catch (abortError) {
          this.logger.error(`Error aborting transaction: ${abortError}`);
        }
      }
      // Don't call ack() here to allow message redelivery
    } finally {
      if (clientSession) {
        await clientSession.endSession();
      }
    }
  }

  private async isTaskAlreadyStarted(
    taskProcessingId: string,
    clientSession?: ClientSession,
  ): Promise<boolean> {
    return this.taskProcessingRepo.checkIfTaskHasStartedAtDate(
      taskProcessingId,
      clientSession,
    );
  }

  private async sendReplyMessage(task: AppTaskProcessingMessage) {
    await this.rabbitMqService.sendMessage(
      task.replyToQueueName,
      JSON.stringify(task),
    );
  }

  private async startTaskProcessing(
    taskProcessingId: string,
    clientSession?: ClientSession,
  ) {
    await this.taskProcessingRepo.updateTaskProcessingWithStartedAtDateTime(
      taskProcessingId,
      clientSession,
    );
    this.logger.debug(`Task processing started for ${taskProcessingId}`);
  }

  private async processTask(
    task: AppTaskProcessingMessage,
  ): Promise<PdfToImagesTaskCompleted> {
    this.logger.debug(`Processing task: ${JSON.stringify(task)}`);

    const taskProcessing = await this.taskProcessingRepo.getTaskProcessingById(
      task.taskProcessingId,
    );

    if (taskProcessing.newArtefactFilename == null) {
      throw new Error('Cannot split pdf into images without a file name');
    }

    return this.appService.splitPdfIntoImages(
      task.infostashId,
      task.artefactId,
      taskProcessing.newArtefactFilename,
    );
  }

  private async completeTaskProcessing(
    task: AppTaskProcessingMessage,
    tmpImageDirectoryLocation: string,
    clientSession?: ClientSession,
  ) {
    const completedTask =
      await this.taskProcessingRepo.updateTaskProcessingWithCompletedAtDateTimeAndWithImageDirLocation(
        task.taskProcessingId,
        tmpImageDirectoryLocation,
        clientSession,
      );

    await this.logger.debug(`Task Completed: ${completedTask.completedAt}`);

    await this.workflowProcessingLogRepo.addTaskProcessingToWorkflowProcessingLogHistory(
      completedTask,
      clientSession,
    );

    // update infostash

    await this.infostashArtefactRepo.updateArtefactWithTempImgDirectory(
      task.infostashId,
      task.artefactId,
      tmpImageDirectoryLocation,
    );

    task.type = 'TASK';
    await this.rabbitMqService.sendMessage(
      task.replyToQueueName,
      JSON.stringify(task),
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
