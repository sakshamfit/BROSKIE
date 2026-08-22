import TextOperation from './TextOperation';

/**
 * OT Client - State machine for collaborative editing
 * 
 * States:
 * - Synchronized: no pending operations, in sync with server
 * - AwaitingConfirm: sent operation, waiting for ack
 * - AwaitingWithBuffer: awaiting confirm + have buffered local operations
 * 
 * This is the classic Jupiter OT client algorithm.
 */

class OTClient {
  constructor(revision = 0) {
    this.revision = revision; // Server revision we are synced to
    this.state = new Synchronized(this);
  }

  // Current document state is managed externally, but we track pending ops
  setState(state) {
    this.state = state;
  }

  // Apply client operation (local edit)
  applyClient(operation) {
    this.setState(this.state.applyClient(operation));
  }

  // Apply server operation (remote edit)
  applyServer(operation) {
    this.revision++;
    this.setState(this.state.applyServer(operation));
  }

  // Server acknowledged our operation
  serverAck() {
    this.revision++;
    this.setState(this.state.serverAck());
  }

  // Server had to transform and retry our operation
  serverRetry() {
    // Server transformed our op, we need to handle it
    this.setState(this.state.serverAck());
  }

  // Get operation to send to server, if any
  getPendingOperation() {
    return this.state.getPendingOperation();
  }

  // Check if we have pending operations
  hasPending() {
    return !(this.state instanceof Synchronized);
  }
}

class Synchronized {
  constructor(client) {
    this.client = client;
  }

  applyClient(operation) {
    // No pending ops, send immediately
    return new AwaitingConfirm(this.client, operation);
  }

  applyServer(operation) {
    // Just apply server operation, stay synchronized
    return this;
  }

  serverAck() {
    throw new Error('No pending operation to ack');
  }

  getPendingOperation() {
    return null;
  }
}

class AwaitingConfirm {
  constructor(client, outstanding) {
    this.client = client;
    this.outstanding = outstanding; // Operation sent to server, awaiting ack
  }

  applyClient(operation) {
    // Buffer the new operation
    return new AwaitingWithBuffer(this.client, this.outstanding, operation);
  }

  applyServer(operation) {
    // Transform outstanding against incoming server operation
    const [outstandingPrime, operationPrime] = TextOperation.transform(this.outstanding, operation);
    // Outstanding is transformed to apply after server op
    return new AwaitingConfirm(this.client, outstandingPrime);
  }

  serverAck() {
    // Outstanding confirmed, go back to synchronized
    return new Synchronized(this.client);
  }

  getPendingOperation() {
    return this.outstanding;
  }
}

class AwaitingWithBuffer {
  constructor(client, outstanding, buffer) {
    this.client = client;
    this.outstanding = outstanding;
    this.buffer = buffer; // Buffered operations not yet sent
  }

  applyClient(operation) {
    // Compose buffer with new operation
    const newBuffer = this.buffer.compose(operation);
    return new AwaitingWithBuffer(this.client, this.outstanding, newBuffer);
  }

  applyServer(operation) {
    // Transform outstanding and buffer against server operation
    const [outstandingPrime, operationPrime] = TextOperation.transform(this.outstanding, operation);
    const [bufferPrime, operationPrime2] = TextOperation.transform(this.buffer, operationPrime);
    return new AwaitingWithBuffer(this.client, outstandingPrime, bufferPrime);
  }

  serverAck() {
    // Outstanding acked, now send buffer
    return new AwaitingConfirm(this.client, this.buffer);
  }

  getPendingOperation() {
    // Don't send buffer until outstanding is acked
    return null;
  }

  getBuffer() {
    return this.buffer;
  }
}

export default OTClient;
export { Synchronized, AwaitingConfirm, AwaitingWithBuffer };
