import { Module } from '@nestjs/common';
import { UserService } from '@app/domain/user/service/user.service';
import { UserRepo } from '@app/domain/user/repo/user.repo';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '@app/domain/user/schema/user.schema';
import { DomainSchemaViewmodelMapperService } from '@app/domain/domain.schema-viewmodel.mapper.service';
import { DomainTransactionService } from '@app/domain/domain.transaction.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [
    UserService,
    UserRepo,
    DomainSchemaViewmodelMapperService,
    DomainTransactionService,
  ],
  exports: [
    UserService,
    DomainSchemaViewmodelMapperService,
    DomainTransactionService,
  ],
})
export class DomainModule {}
