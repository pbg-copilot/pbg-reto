export type FollowUpRecord = {
  id: string;
  description: string;
  due_date: string;
  status: "pending" | "completed";
  created_at: Date;
};

export type FollowUpExpectedClient = {
  expectedClientPath: string;
  expectedClientRecordId: string;
};

export type CreateFollowUpInput = FollowUpExpectedClient & {
  description: string;
  dueDate: string;
};

export type FollowUpWrite = {
  conversationId: string;
  clientPath: string;
  clientRecordId: string;
  actorId: string;
  description: string;
  dueDate: string;
};
