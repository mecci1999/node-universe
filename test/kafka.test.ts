import assert from 'node:assert/strict';
import test from 'node:test';
import KafkaTransporter from '@/lib/transporters/kafka';
import { PacketTypes } from '@/typings/packets';

type ConsumerEvent = 'crash' | 'disconnect' | 'heartbeat';

class FakeConsumer {
  public readonly events = { CRASH: 'crash', DISCONNECT: 'disconnect', HEARTBEAT: 'heartbeat' };
  public connectCalls = 0;
  public disconnectCalls = 0;
  public runCalls = 0;
  public subscriptions: Array<{ topic: string; fromBeginning: boolean }> = [];
  public connectFailures = 0;
  public connectGate: Promise<void> | null = null;
  private listeners = new Map<ConsumerEvent, (event: { payload?: { restart?: boolean } }) => void>();

  public on(event: ConsumerEvent, listener: (event: { payload?: { restart?: boolean } }) => void): void {
    this.listeners.set(event, listener);
  }

  public async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.connectGate) await this.connectGate;
    if (this.connectFailures > 0) {
      this.connectFailures -= 1;
      throw new Error('connect failed');
    }
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  public async subscribe(subscription: { topic: string; fromBeginning: boolean }): Promise<void> {
    this.subscriptions.push(subscription);
  }

  public async run(): Promise<void> {
    this.runCalls += 1;
  }

  public emit(event: ConsumerEvent, payload?: { restart?: boolean }): void {
    this.listeners.get(event)?.({ payload });
  }
}

function createTransporter(consumers: FakeConsumer[], consumerOptions: Record<string, number> = {}) {
  const afterConnectCalls: boolean[] = [];
  const lifecycleEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const transporter = new KafkaTransporter({
    consumer: {
      groupId: 'test-group',
      recoveryBaseDelay: 1,
      recoveryMaxDelay: 1,
      kafkaJsRestartTimeout: 5,
      ...consumerOptions
    }
  });
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const star = {
    instanceID: 'test-node',
    namespace: '',
    getLogger: () => logger,
    broadcastLocal(event: string, payload: Record<string, unknown>) {
      lifecycleEvents.push({ event, payload });
    }
  };
  const transit = { star, nodeID: 'test-node' };
  transporter.init(transit as never, () => undefined, (wasReconnect) => {
    afterConnectCalls.push(wasReconnect);
  });
  transporter.client = {
    consumer: () => {
      const consumer = consumers.shift();
      if (!consumer) throw new Error('No fake consumer available');
      return consumer;
    }
  } as never;

  return { transporter, afterConnectCalls, lifecycleEvents };
}

async function waitForRecovery(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('replaces a crashed consumer, restores subscriptions, and re-announces the node', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter, afterConnectCalls } = createTransporter([original, replacement]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('crash', { restart: false });
  await waitForRecovery();

  assert.equal(original.disconnectCalls, 1);
  assert.equal(replacement.connectCalls, 1);
  assert.equal(replacement.runCalls, 1);
  assert.deepEqual(replacement.subscriptions, [{ topic: 'Universer.INFO.node-a', fromBeginning: false }]);
  assert.equal(transporter.consumer, replacement);
  assert.deepEqual(afterConnectCalls, [true]);
});

test('does not replace a consumer when KafkaJS owns the restart', async () => {
  const original = new FakeConsumer();
  const { transporter, afterConnectCalls } = createTransporter([original]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('crash', { restart: true });
  await waitForRecovery();

  assert.equal(original.disconnectCalls, 0);
  assert.equal(transporter.consumer, original);
  assert.deepEqual(afterConnectCalls, []);
});

test('cancels manual disconnect recovery when KafkaJS claims restart after disconnect', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter, lifecycleEvents } = createTransporter([original, replacement], { recoveryBaseDelay: 100, recoveryMaxDelay: 100 });

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('disconnect');
  original.emit('crash', { restart: true });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(replacement.connectCalls, 0);
  assert.equal(transporter.consumer, original);
  assert.ok(lifecycleEvents.some(({ event }) => event === '$transporter.consumer.recovery.scheduled'));
  assert.ok(lifecycleEvents.some(({ event }) => event === '$transporter.consumer.kafkaJsRestart.started'));
  await transporter.disconnect();
});

test('coalesces crash and disconnect signals into one replacement', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter, afterConnectCalls } = createTransporter([original, replacement]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('crash', { restart: false });
  original.emit('disconnect');
  await waitForRecovery();

  assert.equal(original.disconnectCalls, 1);
  assert.equal(replacement.connectCalls, 1);
  assert.deepEqual(afterConnectCalls, [true]);
});

test('cancels delayed recovery during explicit disconnect without blocking a later recovery', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter, afterConnectCalls } = createTransporter([original, replacement]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('disconnect');
  await transporter.disconnect();
  await waitForRecovery();

  assert.equal(original.disconnectCalls, 1);
  assert.equal(replacement.connectCalls, 0);
  assert.deepEqual(afterConnectCalls, []);
});

test('can recover after a previously scheduled recovery was cancelled', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter, afterConnectCalls } = createTransporter([original, replacement]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('disconnect');
  (transporter as unknown as { cancelConsumerRecovery(): void }).cancelConsumerRecovery();
  await waitForRecovery();

  assert.equal(replacement.connectCalls, 0);
  original.emit('disconnect');
  await waitForRecovery();

  assert.equal(original.disconnectCalls, 1);
  assert.equal(replacement.connectCalls, 1);
  assert.deepEqual(afterConnectCalls, [true]);
});

test('replaces a consumer whose Kafka heartbeats stop', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter, afterConnectCalls } = createTransporter([original, replacement]);
  transporter.options.consumer.healthCheckInterval = 1;
  transporter.options.consumer.heartbeatTimeout = 1;

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  await waitForRecovery();

  assert.equal(original.disconnectCalls, 1);
  assert.equal(replacement.connectCalls, 1);
  assert.deepEqual(afterConnectCalls, [true]);
  await transporter.disconnect();
});

test('ignores stale heartbeat, crash, and disconnect callbacks', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter } = createTransporter([original, replacement]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('crash', { restart: false });
  await waitForRecovery();
  original.emit('heartbeat');
  original.emit('crash', { restart: false });
  original.emit('disconnect');
  await waitForRecovery();

  assert.equal(replacement.disconnectCalls, 0);
  assert.equal(transporter.consumer, replacement);
  await transporter.disconnect();
});

test('keeps KafkaJS restart ownership through its disconnect and takes over only after the deadline', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter, lifecycleEvents } = createTransporter([original, replacement], { kafkaJsRestartTimeout: 2 });

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('crash', { restart: true });
  original.emit('disconnect');
  await new Promise<void>((resolve) => setTimeout(resolve, 3));
  await waitForRecovery();

  assert.equal(replacement.connectCalls, 1);
  assert.ok(lifecycleEvents.some(({ event }) => event === '$transporter.consumer.kafkaJsRestart.started'));
  assert.ok(lifecycleEvents.some(({ event }) => event === '$transporter.consumer.kafkaJsRestart.timedOut'));
  await transporter.disconnect();
});

test('retries after a failed recovery and eventually succeeds with lifecycle events', async () => {
  const original = new FakeConsumer();
  const failed = new FakeConsumer();
  failed.connectFailures = 1;
  const replacement = new FakeConsumer();
  const { transporter, lifecycleEvents } = createTransporter([original, failed, replacement]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('disconnect');
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  await waitForRecovery();

  assert.equal(failed.disconnectCalls, 1);
  assert.equal(transporter.consumer, replacement);
  assert.ok(lifecycleEvents.some(({ event }) => event === '$transporter.consumer.recovery.scheduled'));
  assert.ok(lifecycleEvents.some(({ event }) => event === '$transporter.consumer.recovery.started'));
  assert.ok(lifecycleEvents.some(({ event }) => event === '$transporter.consumer.recovery.failed'));
  assert.ok(lifecycleEvents.some(({ event }) => event === '$transporter.consumer.recovery.succeeded'));
  const recoveryEvents = lifecycleEvents.filter(({ event }) => event.startsWith('$transporter.consumer.recovery.'));
  assert.ok(recoveryEvents.every(({ payload }) => payload.transporter === 'kafka' && typeof payload.generation === 'number'));
  assert.ok(recoveryEvents.every(({ payload }) => typeof payload.recoveryId === 'string'));
  const recoveryIdsByAttempt = new Map<number, Set<unknown>>();
  for (const { payload } of recoveryEvents) {
    const attempt = payload.attempt;
    if (typeof attempt !== 'number') continue;
    const recoveryIds = recoveryIdsByAttempt.get(attempt) || new Set();
    recoveryIds.add(payload.recoveryId);
    recoveryIdsByAttempt.set(attempt, recoveryIds);
  }
  assert.ok([...recoveryIdsByAttempt.values()].every((recoveryIds) => recoveryIds.size === 1));
  assert.notEqual(
    recoveryIdsByAttempt.get(1)?.values().next().value,
    recoveryIdsByAttempt.get(2)?.values().next().value
  );
  const failedEvent = recoveryEvents.find(({ event }) => event === '$transporter.consumer.recovery.failed');
  assert.equal(failedEvent?.payload.consumerGeneration, 4);
  assert.notEqual(failedEvent?.payload.consumerGeneration, failedEvent?.payload.generation);
  const succeeded = recoveryEvents.find(({ event }) => event === '$transporter.consumer.recovery.succeeded');
  assert.equal(succeeded?.payload.consumerGeneration, (transporter as unknown as { consumerRecoveryGeneration: number }).consumerRecoveryGeneration);
  assert.notEqual(succeeded?.payload.consumerGeneration, succeeded?.payload.generation);
  await transporter.disconnect();
});

test('explicit disconnect cancels retry after a recovery failure', async () => {
  const original = new FakeConsumer();
  const failed = new FakeConsumer();
  failed.connectFailures = 1;
  const neverUsed = new FakeConsumer();
  const { transporter } = createTransporter([original, failed, neverUsed], { recoveryBaseDelay: 5, recoveryMaxDelay: 5 });

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('disconnect');
  await new Promise<void>((resolve) => setTimeout(resolve, 7));
  await transporter.disconnect();
  await new Promise<void>((resolve) => setTimeout(resolve, 10));

  assert.equal(neverUsed.connectCalls, 0);
});

test('disconnects a stale in-flight consumer rather than installing it', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const gate = deferred();
  replacement.connectGate = gate.promise;
  const { transporter } = createTransporter([original, replacement]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('disconnect');
  await new Promise<void>((resolve) => setTimeout(resolve, 2));
  const stopping = transporter.disconnect();
  gate.resolve();
  await stopping;

  assert.equal(replacement.disconnectCalls, 1);
  assert.equal(transporter.consumer, null);
});

test('intentional recovery retirement does not schedule a duplicate recovery', async () => {
  const original = new FakeConsumer();
  const replacement = new FakeConsumer();
  const { transporter, lifecycleEvents } = createTransporter([original, replacement]);

  await transporter.makeSubscriptions([{ cmd: PacketTypes.PACKET_INFO, nodeID: 'node-a' }]);
  original.emit('disconnect');
  await waitForRecovery();

  assert.equal(replacement.connectCalls, 1);
  assert.equal(lifecycleEvents.filter(({ event }) => event === '$transporter.consumer.recovery.scheduled').length, 1);
  await transporter.disconnect();
});
