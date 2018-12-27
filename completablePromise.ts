type Resolve<T, TResult> = (value: T) => TResult | PromiseLike<TResult>;
type Reject<TResult> = (reason: any) => TResult | PromiseLike<TResult>;

enum CompletablePromiseState {
  Pending = 'pending',
  Fullfilled = 'fullfilled',
  Rejected = 'rejected',
  Canceled = 'canceled',
}

export class CancellationException extends Error {
  constructor(message?: string) {
    super(message);
  }
}

export class CompletablePromise<T> implements Promise<T> {
  private onFullfilledHandlers: ((value: T) => void)[] = [];
  private onRejectedHandlers: ((reason: unknown) => void)[] = [];
  private state: CompletablePromiseState = CompletablePromiseState.Pending;
  private result: any;

  then<TResult1 = T, TResult2 = never>(
      onFullfilled?: Resolve<T, TResult1> | null,
      onRejected?: Reject<TResult2> | null): Promise<TResult1 | TResult2> {
    if (this.state === CompletablePromiseState.Fullfilled) {
      return onFullfilled ? Promise.resolve(onFullfilled(this.result))
        : Promise.resolve(this.result);
    } else if (this.state === CompletablePromiseState.Rejected) {
      return onRejected ? Promise.reject(onRejected(this.result))
        : Promise.reject(this.result);
    }

    const next = new CompletablePromise<TResult1 | TResult2>();
    this.onFullfilledHandlers.push(value => {
      let nextVal: any;
      if (onFullfilled) {
        try {
          nextVal = onFullfilled(value);
        } catch (error) {
          next.reject(error);
          return;
        }
      } else {
        nextVal = value;
      }

      if (nextVal && nextVal.then) {
        (<PromiseLike<TResult1>>nextVal).then(next.resolve, next.reject);
      } else {
        next.resolve(nextVal);
      }
    });
    this.onRejectedHandlers.push(reason => {
      let nextVal: any;
      if (onRejected) {
        try {
          nextVal = onRejected(reason);
        } catch (error) {
          next.reject(error);
          return;
        }
      } else {
        nextVal = reason;
      }

      if (nextVal && nextVal.then) {
        (<PromiseLike<TResult2>>nextVal).then(next.resolve, next.reject);
      } else {
        next.reject(nextVal);
      }
    });
    return next;
  }

  catch<TResult>(onRejected?: Reject<TResult>): Promise<TResult> {
    return <Promise<TResult>>this.then(undefined, onRejected);
  }

  finally(onFinally?: () => void): Promise<T> {
    function onFinallyWrapper<TResult>(x: TResult): TResult {
      if (onFinally) {
        onFinally();
      }
      return x;
    }
    return this.then(onFinallyWrapper, onFinallyWrapper);
  }

  [Symbol.toStringTag]: any = 'CompletablePromise<T>';

  resolve(value: T): void {
    this.state = CompletablePromiseState.Fullfilled;
    this.result = value;
    for (const h of this.onFullfilledHandlers) {
      h(value);
    }
  }

  reject(reason: any): void {
    this.state = CompletablePromiseState.Rejected;
    this.result = reason;
    for (const h of this.onRejectedHandlers) {
      h(reason);
    }
  }

  cancel(): void {
    this.state = CompletablePromiseState.Canceled;
  }

  get isCancelled(): boolean {
    return this.state === CompletablePromiseState.Canceled;
  }

  throwIfCancelled(): void {
    if (this.isCancelled) {
      throw new CancellationException('operation cancelled');
    }
  }
}
