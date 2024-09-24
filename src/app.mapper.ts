import { Injectable } from "@nestjs/common";
import { AppTaskProcessingMessage } from "./app.task-processing.message";

@Injectable()
export class AppMapper {
  public mapAppTaskProcessingMessage(queueMsg: string): AppTaskProcessingMessage {
    return JSON.parse(queueMsg);
  }
}