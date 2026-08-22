import TextOperation from './TextOperation';

export class WrappedOperation {
  constructor(operation, meta = {}) {
    this.operation = operation instanceof TextOperation ? operation : TextOperation.fromJSON(operation);
    this.meta = {
      userId: meta.userId || null,
      timestamp: meta.timestamp || Date.now(),
      version: meta.version != null ? meta.version : 0,
      baseVersion: meta.baseVersion != null ? meta.baseVersion : 0,
      ...meta
    };
  }

  transform(other) {
    const [aPrime, bPrime] = TextOperation.transform(this.operation, other.operation);
    return [
      new WrappedOperation(aPrime, { ...this.meta }),
      new WrappedOperation(bPrime, { ...other.meta })
    ];
  }

  compose(other) {
    const composed = this.operation.compose(other.operation);
    return new WrappedOperation(composed, {
      ...this.meta,
      version: other.meta.version,
      timestamp: other.meta.timestamp
    });
  }

  apply(doc) {
    return this.operation.apply(doc);
  }

  toJSON() {
    return {
      operation: this.operation.toJSON(),
      meta: this.meta
    };
  }

  static fromJSON(json) {
    return new WrappedOperation(
      TextOperation.fromJSON(json.operation),
      json.meta
    );
  }
}

export class Selection {
  constructor(ranges = []) {
    this.ranges = Array.isArray(ranges) ? ranges : [ranges];
  }

  static fromCursor(cursor) {
    return new Selection([{ anchor: cursor, head: cursor }]);
  }

  static fromRange(anchor, head) {
    return new Selection([{ anchor, head }]);
  }

  transform(operation) {
    const op = operation instanceof TextOperation ? operation : operation.operation;
    const newRanges = this.ranges.map(range => ({
      anchor: TextOperation.transformCursor(range.anchor, op),
      head: TextOperation.transformCursor(range.head, op)
    }));
    return new Selection(newRanges);
  }

  toJSON() {
    return this.ranges;
  }

  static fromJSON(json) {
    return new Selection(json);
  }

  getCursor() {
    return this.ranges[0]?.head ?? 0;
  }
}

export default WrappedOperation;
