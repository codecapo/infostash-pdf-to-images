import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Injectable } from "@nestjs/common";
import { Infostash, InfostashDocument } from "@app/domain";

@Injectable()
export class InfoRepo {
  constructor(
    @InjectModel(Infostash.name)
    private infostashModel: Model<InfostashDocument>,
  ) {}

  public async getArtefactFromInfostash(
    infostashId: string,
    mediaArtefactId: string,
    clientSession?: ClientSession,
  ) {
    const infostashOid = new Types.ObjectId(infostashId);
    const mediaArtefactOid = new Types.ObjectId(mediaArtefactId);

    if (clientSession) {
      return this.infostashModel
        .findOne({
          _id: infostashOid,
          'mediaArtefacts.mediaArtefactId': mediaArtefactOid,
        })
        .session(clientSession);
    } else {
      return this.infostashModel.findOne({
        _id: infostashOid,
        'mediaArtefacts.mediaArtefactId': mediaArtefactOid,
      });
    }
  }
}
