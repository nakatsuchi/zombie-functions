import uuidv4 from 'uuid/v4';
import { Lambda, DynamoDB } from 'aws-sdk';

const docClient = new DynamoDB.DocumentClient();
const HistoryTableName = "ZombieFunctionsHistory";

import { CompletablePromise } from './completablePromise';

export enum HistoryEventType {
  OrchestrationStarted = 'orchestration-started',
  OrchestrationCompleted = 'orchestration-completed',
  OrchestrationFailed = 'orchestration-failed',
  OrchestrationCanceled = 'orchestration-cancelled',
  ActivityScheduled = 'activity-scheduled',
  ActivityStarted = 'activity-started',
  ActivityCompleted = 'activity-completed',
  ActivityFailed = 'activity-failed',
  ActivityCancelled = 'activity-cancelled',
}

type HistoryEvent =
  OrchestrationStartedEvent
  | OrchestrationCompletedEvent
  | OrchestrationFailedEvent
  | OrchestrationCanceledEvent
  | ActivityScheduledEvent
  | ActivityStartedEvent
  | ActivityCompletedEvent
  | ActivityFailedEvent
  | ActivityCancelledEvent;

interface HistoryEventBase {
  orchestrationId: string;
  eventId: number;
  timestamp: Date;
}

interface OrchestrationStartedEvent extends HistoryEventBase {
  eventType: HistoryEventType.OrchestrationStarted;
  input?: unknown;
}

interface OrchestrationCompletedEvent extends HistoryEventBase {
  eventType: HistoryEventType.OrchestrationCompleted;
  result?: unknown;
}

interface OrchestrationFailedEvent extends HistoryEventBase {
  eventType: HistoryEventType.OrchestrationFailed;
  reason?: unknown;
}

interface OrchestrationCanceledEvent extends HistoryEventBase {
  eventType: HistoryEventType.OrchestrationCanceled;
}

interface ActivityEvent extends HistoryEventBase {
  activityId: number;
}

interface ActivityScheduledEvent extends ActivityEvent {
  eventType: HistoryEventType.ActivityScheduled;
  activityName: string;
  input?: undefined;
}

interface ActivityStartedEvent extends ActivityEvent {
  eventType: HistoryEventType.ActivityStarted;
}

interface ActivityCompletedEvent extends ActivityEvent {
  eventType: HistoryEventType.ActivityCompleted;
  result?: unknown;
}

interface ActivityFailedEvent extends ActivityEvent {
  eventType: HistoryEventType.ActivityFailed;
  reason?: unknown;
}

interface ActivityCancelledEvent extends ActivityEvent {
  eventType: HistoryEventType.ActivityCancelled
}

type ActivityCall = {
  activityId: number;
  activityName: string;
  completion: Promise<unknown>;
}

function getHistoryEvents(orchestrationId: string): Promise<HistoryEvent[]> {
  const params = {
    TableName: HistoryTableName,
    KeyConditionExpression: '#orchestrationId = :orchestrationId',
    ExpressionAttributeNames: {
      '#orchestrationId': 'orchestrationId'
    },
    ExpressionAttributeValues: {
      ':orchestrationId': orchestrationId
    }
  };
  return new Promise((resolve, reject) => {
    docClient.query(params, (err, data) => {
      if (err) return reject(err);
      resolve(<HistoryEvent[]>(data.Items || []));
    });
  });
}

export class OrchestrationContext {
  private readonly activityCalls: ActivityCall[] = [];
  private historyEvents: HistoryEvent[] = [];
  private seq: number = 0;
  public isReplaying: boolean = true

  constructor(public orchestrationId: string) {
  }

  private async loadHistory(): Promise<void> {
    this.historyEvents = await getHistoryEvents(this.orchestrationId);
    const calls = {};
    for (const h of this.historyEvents) {
      switch (h.eventType) {
        case HistoryEventType.ActivityScheduled:
          this.activityCalls[h.activityId] = {
            activityId: h.activityId,
            activityName: h.activityName,
            completion: new CompletablePromise<unknown>()
          };
          break;
        case HistoryEventType.ActivityStarted:

      }
    }
  }

  async callActivity<T>(activityName: string, input: any): Promise<T> {
    const activityCall = this.activityCalls[this.seq];
    if (activityCall) {
      return <Promise<T>>activityCall.completion;
    } else {
      const newActivityCall = await this.queueActivity<T>(activityName, input);
      this.activityCalls.push(newActivityCall);
      this.seq++;
      this.isReplaying = false;
      return <Promise<T>>newActivityCall.completion;
    }
  }

  async queueActivity<T>(activityName: string, input: any): Promise<ActivityCall> {
    const activityCall: ActivityCall = {
      completion: new CompletablePromise<T>()
    };
    return activityCall;
  }
}
