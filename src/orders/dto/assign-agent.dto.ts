import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignAgentDto {
  @IsUUID()
  @IsNotEmpty()
  agentId!: string;
}