import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '@app/domain/user/schema/user.schema';
import * as crypto from 'node:crypto';
import { CouldNotFindUserByIdError } from '@app/domain/user/exception/CouldNotFindUserByIdError';
import { RecentInfostash } from '@app/domain/infostash/infostash.schema';
import { DomainSchemaViewmodelMapperService } from '@app/domain/domain.schema-viewmodel.mapper.service';

@Injectable()
export class UserRepo {
  private readonly logger = new Logger(UserRepo.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly domainSchemaViewModelMapperService: DomainSchemaViewmodelMapperService,
  ) {}

  public async createUserProfile(email: string): Promise<User> {
    try {
      const newUser: User = { email: email, tenantUUID: crypto.randomUUID() };
      return new this.userModel(newUser).save();
    } catch (e) {
      this.logger.error(`Could not create user profile for ${email}`);
    }
  }

  public async getUserProfile(userId: string) {
    try {
      const model = await this.userModel.findById(userId);
      const viewModel =
        await this.domainSchemaViewModelMapperService.mapUserSchemaToUserViewModel(
          model,
        );
      return viewModel;
    } catch (e) {
      throw new CouldNotFindUserByIdError({ var1: userId });
    }
  }

  public async addRecentInfostashesToUserProfileAndRemoveOlderEntries(
    userId: Types.ObjectId,
    recentInfostash: RecentInfostash,
  ) {
    const userProfile = await this.userModel.findById(userId);

    let updatedUserProfile: UserDocument;
    if (userProfile) {
      updatedUserProfile = await this.userModel.findByIdAndUpdate(
        { _id: userId },
        { $push: { infostashes: recentInfostash } },
      );

      updatedUserProfile.infostashes.unshift(recentInfostash);
      if (updatedUserProfile.infostashes.length > 10) {
        updatedUserProfile.infostashes.pop();
      }
    }

    const saved = await updatedUserProfile.save();

    const viewModel =
      await this.domainSchemaViewModelMapperService.mapUserSchemaToUserViewModel(
        saved,
      );
    return viewModel;
  }
}
