import { Injectable, Logger } from '@nestjs/common';
import * as fsp from 'fs/promises';
import * as crypto from 'node:crypto';
import { fromPath } from 'pdf2pic';
import { PDFDocument } from 'pdf-lib';
import * as path from 'path';
import * as os from 'os';
import { PdfToImagesTaskCompleted } from '../libs/workflow/pdf-to-images.task.completed';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  getHello(): string {
    return 'Hello World!';
  }

  public async splitPdfIntoImages(
    infostashId: string,
    artefactId: string,
    newfilename: string,
  ): Promise<PdfToImagesTaskCompleted> {
    this.validateInputs(infostashId, artefactId, newfilename);

    const pdfFolder = path.join(os.tmpdir(), infostashId);
    const imageDir = path.join(pdfFolder, artefactId, 'image');
    const pdfFile = path.join(
      pdfFolder,
      artefactId,
      'pdf',
      `${newfilename}.pdf`,
    );

    await this.ensureDirectoryExists(imageDir);
    this.logger.debug(`images will be saved here: ${imageDir}`);

    const pdfDoc = await this.loadPdfDocument(pdfFile);

    this.logger.debug(
      `Loaded pdf ${pdfDoc.getTitle()} with ${pdfDoc.getPageCount()} pages`,
    );

    if (await this.isDirectoryPopulated(imageDir)) {
      this.logger.debug(
        `Image directory exists and is populated: ${imageDir}, skipping image creation`,
      );
      return {
        imagesCreated: true,
        tmpImageDirectoryLocation: imageDir,
      };
    }

    const imagesCreated = await this.createImagesFromPdfPages(
      imageDir,
      pdfFile,
      pdfDoc,
    );

    return {
      imagesCreated: imagesCreated,
      tmpImageDirectoryLocation: imageDir,
    };
  }

  private validateInputs(...inputs: string[]): void {
    if (inputs.some((input) => input == null || input.trim() === '')) {
      throw new Error('All input parameters must be provided and non-empty');
    }
  }

  private async ensureDirectoryExists(dir: string): Promise<void> {
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (error) {
      this.logger.error(`Failed to create directory ${dir}: ${error.message}`);
      throw error;
    }
  }

  private async loadPdfDocument(file: string): Promise<PDFDocument> {
    try {
      const pdfBuffer = await fsp.readFile(file);
      return await PDFDocument.load(pdfBuffer);
    } catch (error) {
      this.logger.error(`Failed to load PDF from ${file}: ${error.message}`);
      throw error;
    }
  }

  private async isDirectoryPopulated(dir: string): Promise<boolean> {
    try {
      const files = await fsp.readdir(dir);
      return files.length > 0;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private async createImagesFromPdfPages(
    imageDir: string,
    pdfFile: string,
    pdfDoc: PDFDocument,
  ): Promise<boolean> {
    const options = {
      density: 330,
      saveFilename: crypto.randomUUID(),
      savePath: imageDir,
      format: 'jpg',
      width: 1000,
      height: 1000,
    };

    const convert = fromPath(pdfFile, options);
    const totalPages = pdfDoc.getPageCount();
    let convertedPages = 0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const result = await convert(pageNum, { responseType: 'image' });
        this.logger.debug(
          `Created image for pdf page ${result.page} ${result.name}`,
        );
        convertedPages++;
      } catch (error) {
        this.logger.error(
          `Error converting page ${pageNum} to image: ${error.message}`,
        );
        // Consider whether to throw here or continue with next page
      }
    }

    const allPagesConverted = convertedPages === totalPages;

    if (allPagesConverted) {
      this.logger.debug('Successfully converted all pages to images');
    } else {
      this.logger.warn(
        `Converted ${convertedPages} out of ${totalPages} pages`,
      );
    }

    return allPagesConverted;
  }
}
