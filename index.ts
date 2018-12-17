import uuidv4 from 'uuid/v4';
import { Lambda, DynamoDB } from 'aws-sdk';

const docClient = new DynamoDB.DocumentClient();
const HistoryTableName = "ZombieFunctionsHistory";

interface OrchestrationContext {
    jobId: string;
    history: any[];
    seq: number;
}

// アクティビティを実行する
function callActivity<T>(ctx: OrchestrationContext, f: (input: any) => Promise<T>, input: any): Promise<T> {
    let promise;
    let replaying;
    if (ctx.seq < ctx.history.length) {
        // 実行済みなら以前の結果を即座に返す
        promise = Promise.resolve(ctx.history[ctx.seq].result);
        replaying = true;
        ctx.seq += 1;
    } else {
        // 未実行箇所に達したら実際にアクティビティを実行する
        promise = f(input).then(result => {
            return addHistoryItem(ctx, result).then(() => {
                return result;
            });
        });
        replaying = false;
    }
    (<any>promise).replaying = replaying;
    return promise;
}

// テーブルにジョブを登録する
function initializeHistory(jobId: string) {
    const params = {
        TableName: HistoryTableName,
        Item: {
            jobId: jobId,
            history: []
        }
    };
    return new Promise((resolve, reject) => {
        docClient.put(params, (err, data) => {
            if (err) return reject(err);
            resolve();
        }) 
    });
}

// テーブルから履歴をまとめて取得する
function getHistory(jobId: string): Promise<any[]> {
    const params = {
        TableName: HistoryTableName,
        Key: { jobId }
    };
    return new Promise((resolve, reject) => {
        docClient.get(params, (err, data) => {
            if (err) return reject(err);
            resolve(data.Item && data.Item.history);
        }) 
    });
}

// アクティビティの実行結果を記録する
function addHistoryItem(ctx: OrchestrationContext, result: any) {
    const params = {
        TableName: HistoryTableName,
        Key: { jobId: ctx.jobId },
        UpdateExpression: 'SET #history = list_append(#history, :histitem)',
        ExpressionAttributeNames: {
            '#history': 'history'
        },
        ExpressionAttributeValues: {
            ':histitem': [result]
        }
    };
    return new Promise((resolve, reject) => {
        docClient.update(params, (err, data) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

// 次の Lambda 関数の実行をスケジュールする
function continueAsNewEvent(jobId: string) {
    const lambda = new Lambda();
    return new Promise<any>((resolve, reject) => {
        lambda.invoke({
            FunctionName: 'zombie-function',
            InvocationType: 'Event',
            Payload: JSON.stringify({
                zombie: {
                    jobId: jobId
                }
            })
        }, (err, data) => {
            if (err) {
                return reject(err);
            }
            return resolve(data);
        });
    });
}

// Lambda の entry point
export async function handler(event: any, context: any): Promise<any> {
    const zombie = event.zombie;
    let jobId: string;
    let history: any[];
    if (!zombie) {
        // 新しくジョブを開始する
        jobId = uuidv4().replace(/-/g, '');
        console.log(`job start: jobId=${jobId}`);
        initializeHistory(jobId);
        history = [];
    } else {
        // 実行済みのジョブを継続する
        jobId = zombie.jobId;
        history = await getHistory(jobId);
    }

    const orchestrationContext: OrchestrationContext = { jobId, history, seq: 0 };

    const o = orchestrator(orchestrationContext, event);
    let state: IteratorResult<Promise<any>>;
    while (true) {
        state = o.next();
        if (state.done) {
            console.log(`job complete: jobId=${jobId}`);
            return { jobId, state: 'complete' };
        }

        // 既に実行済みのアクティビティはスキップし、未実行のアクティビティに達したら一つだけ実行して終了
        // 続きは次回の実行時に継続する
        if (!(<any>state.value).replaying) {
            const result = await state.value;
            console.log(`job yield: jobId=${jobId}`);
            await continueAsNewEvent(jobId);
            return { jobId, state: 'running', result };
        }
    }
}

// Activity
function print(input: any): Promise<string> {
    console.log(input.message);
    return Promise.resolve('OK');
}

// Orchestrator
// 50 までの Fizz Buzz
function* orchestrator(ctx: OrchestrationContext, event: any): IterableIterator<Promise<any>> {
    for (let i = 1; i <= 50; i++) {
        if (i % 15 === 0) {
            yield callActivity(ctx, print, { message: 'Fizz Buzz' });
        } else if (i % 3 === 0) {
            yield callActivity(ctx, print, { message: 'Fizz' });
        } else if (i % 5 === 0) {
            yield callActivity(ctx, print, { message: 'Buzz' });
        } else {
            yield callActivity(ctx, print, { message: i });
        }
    }
}
