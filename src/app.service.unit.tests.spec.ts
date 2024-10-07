import { TestBed } from '@automock/jest';
import { AppService } from './app.service';
import * as fsp from 'fs/promises';
import { PDFDocument } from 'pdf-lib';
import * as pdf2pic from 'pdf2pic';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

jest.mock('fs/promises');
jest.mock('pdf-lib');
jest.mock('pdf2pic');
jest.mock('path');
jest.mock('os');
jest.mock('crypto');

describe('AppService', () => {
  let service: AppService;

  beforeAll(() => {
    const { unit } = TestBed.create(AppService).compile();
    service = unit;

    // Mock environment variables
    process.env.OBJECT_STORE_URL = 'mock-url';
    process.env.OBJECT_STORE_REGION = 'mock-region';
    process.env.OBJECT_STORE_ACCESS_ID = 'mock-id';
    process.env.OBJECT_STORE_ACCESS_SECRET = 'mock-secret';
    process.env.OBJECT_STORE_NAME = 'mock-name';

    // Default mock implementations
    (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
    (os.tmpdir as jest.Mock).mockReturnValue('/tmp');
    (crypto.randomUUID as jest.Mock).mockReturnValue('mock-uuid');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      expect(service.getHello()).toBe('Hello World!');
    });
  });

  describe('splitPdfIntoImages', () => {
    const mockInfostashId = 'mockInfostashId';
    const mockArtefactId = 'mockArtefactId';
    const mockNewFilename = 'mockNewFilename';

    beforeEach(() => {
      jest.spyOn(fsp, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fsp, 'readFile').mockResolvedValue(Buffer.from('mock pdf content'));
      jest.spyOn(fsp, 'readdir').mockResolvedValue([]);
      (PDFDocument.load as jest.Mock).mockResolvedValue({
        getTitle: jest.fn().mockReturnValue('Mock PDF'),
        getPageCount: jest.fn().mockReturnValue(3),
      });
      (pdf2pic.fromPath as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue({
        page: 1,
        name: 'mockImage.jpg',
      }));
    });

    it('should throw an error if input parameters are empty', async () => {
      await expect(service.splitPdfIntoImages('', mockArtefactId, mockNewFilename))
        .rejects.toThrow('All input parameters must be provided and non-empty');
    });

    it('should skip image creation if directory is already populated', async () => {
      (fsp.readdir as jest.Mock).mockResolvedValueOnce(['existingImage.jpg']);

      const result = await service.splitPdfIntoImages(mockInfostashId, mockArtefactId, mockNewFilename);

      expect(result).toEqual({
        imagesCreated: true,
        tmpImageDirectoryLocation: expect.stringContaining(mockArtefactId),
      });
      expect(pdf2pic.fromPath).not.toHaveBeenCalled();
      expect(PDFDocument.load).not.toHaveBeenCalled();
    });

    it('should create images if directory is empty', async () => {
      const result = await service.splitPdfIntoImages(mockInfostashId, mockArtefactId, mockNewFilename);

      expect(result).toEqual({
        imagesCreated: true,
        tmpImageDirectoryLocation: expect.stringContaining(mockArtefactId),
      });
      expect(pdf2pic.fromPath).toHaveBeenCalled();
      expect(PDFDocument.load).toHaveBeenCalled();
    });

    it('should handle errors when creating directory', async () => {
      (fsp.mkdir as jest.Mock).mockRejectedValueOnce(new Error('Directory creation failed'));

      await expect(service.splitPdfIntoImages(mockInfostashId, mockArtefactId, mockNewFilename))
        .rejects.toThrow('Directory creation failed');
    });

    it('should handle errors when loading PDF', async () => {
      (PDFDocument.load as jest.Mock).mockRejectedValueOnce(new Error('PDF load failed'));

      await expect(service.splitPdfIntoImages(mockInfostashId, mockArtefactId, mockNewFilename))
        .rejects.toThrow('PDF load failed');
    });

    it('should handle errors when converting pages to images', async () => {
      const mockConvert = jest.fn()
        .mockResolvedValueOnce({ page: 1, name: 'page1.jpg' })
        .mockRejectedValueOnce(new Error('Conversion failed'))
        .mockResolvedValueOnce({ page: 3, name: 'page3.jpg' });
      (pdf2pic.fromPath as jest.Mock).mockReturnValue(mockConvert);

      const result = await service.splitPdfIntoImages(mockInfostashId, mockArtefactId, mockNewFilename);

      expect(result).toEqual({
        imagesCreated: false,
        tmpImageDirectoryLocation: expect.stringContaining(mockArtefactId),
      });
      expect(mockConvert).toHaveBeenCalledTimes(3);
    });
  });
});