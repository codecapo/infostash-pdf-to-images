import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InfostashDocument } from '@app/domain';
import { ClientSession, Model, Types } from 'mongoose';

@Injectable()
export class InfostashArtefactRepo {
  constructor(
    @InjectModel('Infostash')
    private infostashModel: Model<InfostashDocument>,
  ) {}

  public async updateArtefactWithTempImgDirectory(
    infostashId: string,
    mediaArtifactId: string,
    tmpImgDirectory: string,
    clientSession?: ClientSession,
  ) {
    const locate = {
      _id: new Types.ObjectId(infostashId),
      'mediaArtefacts.mediaArtefactId': new Types.ObjectId(mediaArtifactId),
    };
    const update = {
      $set: {
        'mediaArtefacts.$.imagesTempDirLocation': tmpImgDirectory,
      },
    };
    const updatedInfostash = await this.infostashModel
      .findOneAndUpdate(locate, update, { new: true })
      .session(clientSession);

    if (clientSession) {
      const updatedInfostashTransctional = await this.infostashModel
        .findOneAndUpdate(locate, update, { new: true })
        .session(clientSession);

      return updatedInfostashTransctional;
    } else {
      return updatedInfostash;
    }
  }
}
