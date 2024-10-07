import { TestBed } from '@automock/jest';
import { AppWorker } from './app.worker';
import { AppMapper } from './app.mapper';
import { AppService } from './app.service';
import { RabbitMqService } from '@app/rabbit-mq';
import { MongodbService } from '@app/mongodb';
import { TaskProcessingRepo } from '../libs/workflow/repo/task-processing.repo';
import { InfostashArtefactRepo } from '../libs/domain/infostash-artefact.repo';
import { WorkflowProcessingLogRepo } from '../libs/workflow/repo/workflow-processing-log.repo';
import { AppTaskProcessingMessage } from './app.task-processing.message';
import { PdfToImagesTaskCompleted } from '../libs/workflow/pdf-to-images.task.completed';
import { ClientSession } from 'mongoose';

jest.mock('@nestjs/common', () => ({
  ...jest.requireActual('@nestjs/common'),
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('AppWorker', () => {
  let worker: AppWorker;
  let appMapper: jest.Mocked<AppMapper>;
  let appService: jest.Mocked<AppService>;
  let rabbitMqService: jest.Mocked<RabbitMqService>;
  let mongodbService: jest.Mocked<MongodbService>;
  let taskProcessingRepo: jest.Mocked<TaskProcessingRepo>;
  let infostashArtefactRepo: jest.Mocked<InfostashArtefactRepo>;
  let workflowProcessingLogRepo: jest.Mocked<WorkflowProcessingLogRepo>;

  beforeAll(() => {
    const { unit, unitRef } = TestBed.create(AppWorker).compile();

    worker = unit;
    appMapper = unitRef.get(AppMapper);
    appService = unitRef.get(AppService);
    rabbitMqService = unitRef.get(RabbitMqService);
    mongodbService = unitRef.get(MongodbService);
    taskProcessingRepo = unitRef.get(TaskProcessingRepo);
    infostashArtefactRepo = unitRef.get(InfostashArtefactRepo);
    workflowProcessingLogRepo = unitRef.get(WorkflowProcessingLogRepo);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should set up message consumer successfully', async () => {
      (rabbitMqService.consumeMessages as jest.Mock).mockResolvedValue(undefined);

      await worker.onModuleInit();

      expect(rabbitMqService.consumeMessages).toHaveBeenCalledWith(
        undefined,
        expect.any(Function)
      );
    });

    it('should handle error when setting up message consumer', async () => {
      const error = new Error('Failed to set up consumer');
      (rabbitMqService.consumeMessages as jest.Mock).mockRejectedValue(error);

      await worker.onModuleInit();

      expect(rabbitMqService.consumeMessages).toHaveBeenCalled();
      expect((worker as any).logger.error).toHaveBeenCalledWith(`Failed to set up message consumer: ${error}`);
    });
  });

  describe('handleMessage', () => {
    const mockMessage = {
      content: Buffer.from(JSON.stringify({ taskProcessingId: '123' })),
    };
    const mockAck = jest.fn();
    const mockClientSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    } as unknown as ClientSession;

    beforeEach(() => {
      (mongodbService.mongoConnection as jest.Mock).mockResolvedValue({
        startSession: jest.fn().mockResolvedValue(mockClientSession),
      });
      (appMapper.mapAppTaskProcessingMessage as jest.Mock).mockReturnValue({
        taskProcessingId: '123',
        replyToQueueName: 'replyQueue',
        infostashId: 'infostash1',
        artefactId: 'artefact1',
      } as AppTaskProcessingMessage);
      (taskProcessingRepo.checkIfTaskHasStartedAtDate as jest.Mock).mockResolvedValue(false);
      (taskProcessingRepo.getTaskProcessingById as jest.Mock).mockResolvedValue({
        newArtefactFilename: 'test.pdf',
      });
      (appService.splitPdfIntoImages as jest.Mock).mockResolvedValue({
        tmpImageDirectoryLocation: '/tmp/images',
      } as PdfToImagesTaskCompleted);
      (taskProcessingRepo.updateTaskProcessingWithCompletedAtDateTimeAndWithImageDirLocation as jest.Mock).mockResolvedValue({
        completedAt: new Date(),
      });
      (rabbitMqService.sendMessage as jest.Mock).mockResolvedValue(undefined);
    });

    it('should process a valid message successfully', async () => {
      await (worker as any).handleMessage(mockMessage, mockAck);

      expect(rabbitMqService.sendMessage).toHaveBeenCalledTimes(2);
      expect(taskProcessingRepo.updateTaskProcessingWithStartedAtDateTime).toHaveBeenCalled();
      expect(appService.splitPdfIntoImages).toHaveBeenCalled();
      expect(taskProcessingRepo.updateTaskProcessingWithCompletedAtDateTimeAndWithImageDirLocation).toHaveBeenCalled();
      expect(workflowProcessingLogRepo.addTaskProcessingToWorkflowProcessingLogHistory).toHaveBeenCalled();
      expect(infostashArtefactRepo.updateArtefactWithTempImgDirectory).toHaveBeenCalled();
      expect(mockClientSession.commitTransaction).toHaveBeenCalled();
      expect(mockAck).toHaveBeenCalled();
    });

    it('should skip processing if task is already started', async () => {
      (taskProcessingRepo.checkIfTaskHasStartedAtDate as jest.Mock).mockResolvedValue(true);

      await (worker as any).handleMessage(mockMessage, mockAck);

      expect(appService.splitPdfIntoImages).not.toHaveBeenCalled();
      expect(mockClientSession.commitTransaction).toHaveBeenCalled();
      expect(mockAck).toHaveBeenCalled();
    });

    it('should handle errors and abort transaction', async () => {
      (appService.splitPdfIntoImages as jest.Mock).mockRejectedValue(new Error('Test error'));

      await (worker as any).handleMessage(mockMessage, mockAck);

      expect(mockClientSession.abortTransaction).toHaveBeenCalled();
      expect(mockAck).not.toHaveBeenCalled();
      expect((worker as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('Test error'));
    });

    it('should handle null message', async () => {
      await (worker as any).handleMessage(null, mockAck);

      expect(appMapper.mapAppTaskProcessingMessage).not.toHaveBeenCalled();
      expect(mockAck).not.toHaveBeenCalled();
    });

    it('should handle missing newArtefactFilename', async () => {
      (taskProcessingRepo.getTaskProcessingById as jest.Mock).mockResolvedValue({});

      await (worker as any).handleMessage(mockMessage, mockAck);

      expect(appService.splitPdfIntoImages).not.toHaveBeenCalled();
      expect(mockClientSession.abortTransaction).toHaveBeenCalled();
      expect(mockAck).not.toHaveBeenCalled();
      expect((worker as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Cannot split pdf into images without a file name')
      );
    });

    it('should handle database session error', async () => {
      (mongodbService.mongoConnection as jest.Mock).mockRejectedValue(new Error('Database connection error'));

      await (worker as any).handleMessage(mockMessage, mockAck);

      expect(mockAck).not.toHaveBeenCalled();
      expect((worker as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('Database connection error'));
    });

    it('should handle error in sendReplyMessage', async () => {
      (rabbitMqService.sendMessage as jest.Mock).mockRejectedValueOnce(new Error('Failed to send message'));

      await (worker as any).handleMessage(mockMessage, mockAck);

      expect(mockClientSession.abortTransaction).toHaveBeenCalled();
      expect(mockAck).not.toHaveBeenCalled();
      expect((worker as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to send message'));
    });

    it('should handle error in startTaskProcessing', async () => {
      (taskProcessingRepo.updateTaskProcessingWithStartedAtDateTime as jest.Mock).mockRejectedValue(new Error('Failed to start task'));

      await (worker as any).handleMessage(mockMessage, mockAck);

      expect(mockClientSession.abortTransaction).toHaveBeenCalled();
      expect(mockAck).not.toHaveBeenCalled();
      expect((worker as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to start task'));
    });

    it('should handle error in completeTaskProcessing', async () => {
      // Make sure all previous steps succeed
      (taskProcessingRepo.updateTaskProcessingWithStartedAtDateTime as jest.Mock).mockResolvedValue(undefined);
      (appService.splitPdfIntoImages as jest.Mock).mockResolvedValue({
        tmpImageDirectoryLocation: '/tmp/images',
      } as PdfToImagesTaskCompleted);

      // Mock the error in completeTaskProcessing
      (taskProcessingRepo.updateTaskProcessingWithCompletedAtDateTimeAndWithImageDirLocation as jest.Mock)
        .mockRejectedValue(new Error('Failed to complete task'));

      await (worker as any).handleMessage(mockMessage, mockAck);

      expect(mockClientSession.abortTransaction).toHaveBeenCalled();
      expect(mockAck).not.toHaveBeenCalled();
      expect((worker as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to complete task'));
    });
  });
});