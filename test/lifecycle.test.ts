import assert from 'node:assert/strict';
import test from 'node:test';
import MetricRate from '@/lib/metrics/rates';
import TimeWindowQuantiles from '@/lib/metrics/type/histogram/timeWindowQuantiles';
import Transit from '@/lib/transit';
import NodeCatalog from '@/lib/registry/catalogs/node';
import BaseDiscoverer from '@/lib/registry/discoverers/base';
import Node from '@/lib/registry/node';
import ActionCatalog from '@/lib/registry/catalogs/action';
import EventCatalog from '@/lib/registry/catalogs/event';
import ServiceCatalog from '@/lib/registry/catalogs/service';
import { TransitRequest } from '@/typings/transit';

type ExpiringTransitRequest = TransitRequest & { timestamp: number };

function instanceEpoch(wallClock: number, monotonic: number): string {
  return `${wallClock.toString().padStart(16, '0')}-${monotonic.toString().padStart(24, '0')}`;
}

function createNodeCatalogForInfoTests() {
  const catalog = Object.create(NodeCatalog.prototype) as NodeCatalog;
  const registrations: Array<{ nodeID: string; services: unknown[] }> = [];
  const unregistrations: string[] = [];
  const broadcasts: Array<{ event: string; payload: Record<string, unknown> }> = [];

  catalog.nodes = new Map();
  catalog.registry = {
    registerServices(node: { id: string }, services: unknown[]) {
      registrations.push({ nodeID: node.id, services });
    },
    unregisterServicesByNode(nodeID: string) {
      unregistrations.push(nodeID);
    }
  } as never;
  catalog.star = {
    broadcastLocal(event: string, payload: Record<string, unknown>) {
      broadcasts.push({ event, payload });
    }
  } as never;
  (catalog as never as { logger: { info(): void; debug(): void; warn(): void } }).logger = {
    info() {},
    debug() {},
    warn() {}
  };

  return { catalog, registrations, unregistrations, broadcasts };
}

function createHeartbeatDiscoverer(node: Node) {
  const discoverer = Object.create(BaseDiscoverer.prototype) as BaseDiscoverer;
  const discoveries: string[] = [];
  discoverer.registry = {
    nodes: {
      get(nodeID: string) {
        return nodeID === node.id ? node : undefined;
      }
    }
  } as never;
  discoverer.logger = { debug() {} } as never;
  discoverer.discoverNode = ((nodeID?: string) => {
    if (nodeID) discoveries.push(nodeID);
    return Promise.resolve();
  }) as never;

  return { discoverer, discoveries };
}

function remoteNodeInfo(overrides: Record<string, unknown> = {}) {
  return {
    sender: 'metrics-production-metrics',
    instanceID: 'instance-a',
    seq: 1,
    metadata: {},
    ipList: ['10.0.0.1'],
    hostname: 'metrics',
    port: 3000,
    client: { type: 'nodejs' },
    config: {},
    services: [{ name: 'metrics', version: 1, actions: { overview: {} } }],
    ...overrides
  };
}

test('MetricRate disposes its owned interval exactly once', () => {
  const rate = new MetricRate({ changed() {} } as never, { value: 0, labels: {} }, 1);
  const timer = rate.timer;

  rate.dispose();
  rate.dispose();

  assert.equal(rate.timer, null);
  assert.ok(timer);
});

test('TimeWindowQuantiles disposes its scheduled rotation', () => {
  const quantiles = new TimeWindowQuantiles({ setDirty() {} } as never, [0.5], 60, 2);
  const timer = quantiles.rotateTimer;

  quantiles.dispose();
  quantiles.dispose();

  assert.equal(quantiles.rotateTimer, null);
  assert.ok(timer);
});

test('Transit expires a pending request and destroys its associated streams', () => {
  const transit = Object.create(Transit.prototype) as Transit;
  const cleared: NodeJS.Timeout[] = [];
  const timeout = setTimeout(() => undefined, 60_000);
  const requestStream = {
    $createdAt: 0,
    $pool: new Map([[1, 'chunk']]),
    $poolTimeout: new Map([[1, timeout]]),
    destroyed: false,
    destroy() {
      this.destroyed = true;
    }
  };
  let rejected: unknown;
  const pendingRequest: ExpiringTransitRequest = {
    timestamp: Date.now() - 300_001,
    reject(error: Error) {
      rejected = error;
    }
  } as ExpiringTransitRequest;
  transit.pendingRequests = new Map<string, TransitRequest>([
    [
      'request-1',
      pendingRequest
    ]
  ]);
  transit.pendingReqStreams = new Map([['request-1', requestStream]]);
  transit.pendingResStreams = new Map();
  transit.logger = { warn() {} } as never;

  const originalClearTimeout = global.clearTimeout;
  global.clearTimeout = ((handle: NodeJS.Timeout) => {
    cleared.push(handle);
    originalClearTimeout(handle);
  }) as typeof clearTimeout;
  try {
    (transit as never as { cleanupExpiredRequests(): void }).cleanupExpiredRequests();
  } finally {
    global.clearTimeout = originalClearTimeout;
  }

  assert.equal(transit.pendingRequests.size, 0);
  assert.equal(transit.pendingReqStreams.size, 0);
  assert.equal(requestStream.$pool.size, 0);
  assert.equal(requestStream.$poolTimeout.size, 0);
  assert.equal(requestStream.destroyed, true);
  assert.deepEqual(cleared, [timeout]);
  assert.ok(rejected instanceof Error);
  assert.equal(rejected.message, 'Request timeout during cleanup');
});

test('Transit disconnect cancels its owned reconnect timer', async () => {
  const transit = Object.create(Transit.prototype) as Transit;
  const timer = setTimeout(() => undefined, 60_000);
  let cleared: NodeJS.Timeout | null = null;
  const originalClearTimeout = global.clearTimeout;
  global.clearTimeout = ((handle: NodeJS.Timeout) => {
    cleared = handle;
    originalClearTimeout(handle);
  }) as typeof clearTimeout;
  transit.logger = { info() {}, warn() {}, debug() {} } as never;
  transit.transporter = {
    connected: false,
    disconnect() {
      return Promise.resolve();
    }
  } as never;
  transit.star = { broadcastLocal() {} } as never;
  transit.metrics = null;
  transit.discoverer = null;
  transit.disconnecting = false;
  (transit as never as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer = timer;
  try {
    await transit.disconnect();
    assert.equal((transit as never as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer, null);
    assert.equal(cleared, timer);
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});

test('deleting an offline remote node cascades service and pending-request cleanup', () => {
  const catalog = Object.create(NodeCatalog.prototype) as NodeCatalog;
  const removedNodes: string[] = [];
  const removedRequests: string[] = [];
  catalog.nodes = new Map([['remote-node', { id: 'remote-node', local: false } as never]]);
  catalog.registry = {
    unregisterServicesByNode(nodeID: string) {
      removedNodes.push(nodeID);
    }
  } as never;
  catalog.star = {
    transit: {
      removePendingRequestByNodeID(nodeID: string) {
        removedRequests.push(nodeID);
      }
    }
  } as never;

  assert.equal(catalog.delete('remote-node'), true);
  assert.deepEqual(removedNodes, ['remote-node']);
  assert.deepEqual(removedRequests, ['remote-node']);
  assert.equal(catalog.nodes.has('remote-node'), false);
});

test('NodeCatalog rejects delayed INFO from an older process generation before it mutates a reconnected node', () => {
  const { catalog, registrations, broadcasts } = createNodeCatalogForInfoTests();
  const currentInfo = remoteNodeInfo({
    instanceID: 'metrics-new',
    instanceEpoch: instanceEpoch(2000, 2),
    seq: 1
  });
  const node = catalog.processNodeInfo(currentInfo);
  const currentRawInfo = node.rawInfo;
  const currentServices = node.services;

  node.available = false;
  node.offlineSince = 42;
  const broadcastsBeforeStaleInfo = broadcasts.length;

  const result = catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-old',
      instanceEpoch: instanceEpoch(1000, 1),
      seq: 999,
      services: []
    })
  );

  assert.equal(result, node);
  assert.equal(node.instanceID, 'metrics-new');
  assert.equal(node.instanceEpoch, instanceEpoch(2000, 2));
  assert.equal(node.seq, 1);
  assert.equal(node.available, false);
  assert.equal(node.offlineSince, 42);
  assert.equal(node.rawInfo, currentRawInfo);
  assert.equal(node.services, currentServices);
  assert.equal(registrations.length, 1);
  assert.equal(broadcasts.length, broadcastsBeforeStaleInfo);
});

test('NodeCatalog accepts a newer process generation even when its INFO sequence restarts lower', () => {
  const { catalog, registrations } = createNodeCatalogForInfoTests();

  catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-old',
      instanceEpoch: instanceEpoch(1000, 1),
      seq: 100,
      services: [{ name: 'old-catalog' }]
    })
  );
  const node = catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-new',
      instanceEpoch: instanceEpoch(2000, 1),
      seq: 1,
      services: [{ name: 'new-catalog' }]
    })
  );

  assert.equal(node.instanceID, 'metrics-new');
  assert.equal(node.instanceEpoch, instanceEpoch(2000, 1));
  assert.equal(node.seq, 1);
  assert.deepEqual(node.services, [{ name: 'new-catalog' }]);
  assert.equal(registrations.length, 2);
  assert.deepEqual(registrations[1], {
    nodeID: 'metrics-production-metrics',
    services: [{ name: 'new-catalog' }]
  });
});

test('NodeCatalog keeps accepting legacy INFO without an instance epoch when its instance changes', () => {
  const { catalog, registrations } = createNodeCatalogForInfoTests();

  catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-legacy-old',
      seq: 100,
      services: [{ name: 'legacy-old-catalog' }]
    })
  );
  const node = catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-legacy',
      seq: 1,
      services: [{ name: 'legacy-catalog' }]
    })
  );

  assert.equal(node.instanceID, 'metrics-legacy');
  assert.equal(node.instanceEpoch, null);
  assert.equal(node.seq, 1);
  assert.deepEqual(node.services, [{ name: 'legacy-catalog' }]);
  assert.equal(registrations.length, 2);
});

test('NodeCatalog rejects a delayed epoch-less shutdown INFO after a newer process generation is known', () => {
  const { catalog, registrations, broadcasts } = createNodeCatalogForInfoTests();
  const node = catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-new',
      instanceEpoch: instanceEpoch(2000, 1),
      seq: 1,
      services: [{ name: 'new-catalog' }]
    })
  );
  const currentRawInfo = node.rawInfo;
  const currentServices = node.services;
  const broadcastsBeforeShutdownInfo = broadcasts.length;

  catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-old',
      seq: 101,
      services: []
    })
  );

  assert.equal(node.instanceID, 'metrics-new');
  assert.equal(node.instanceEpoch, instanceEpoch(2000, 1));
  assert.equal(node.seq, 1);
  assert.equal(node.rawInfo, currentRawInfo);
  assert.equal(node.services, currentServices);
  assert.equal(registrations.length, 1);
  assert.equal(broadcasts.length, broadcastsBeforeShutdownInfo);
});

test('NodeCatalog leaves an out-of-order same-generation INFO snapshot untouched', () => {
  const { catalog, registrations, broadcasts } = createNodeCatalogForInfoTests();
  const node = catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-current',
      instanceEpoch: instanceEpoch(2000, 1),
      seq: 10,
      services: [{ name: 'current-catalog' }]
    })
  );
  const currentRawInfo = node.rawInfo;
  const currentServices = node.services;
  const broadcastsBeforeOutOfOrderInfo = broadcasts.length;

  catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-current',
      instanceEpoch: instanceEpoch(2000, 1),
      seq: 9,
      services: []
    })
  );

  assert.equal(node.seq, 10);
  assert.equal(node.rawInfo, currentRawInfo);
  assert.equal(node.services, currentServices);
  assert.equal(registrations.length, 1);
  assert.equal(broadcasts.length, broadcastsBeforeOutOfOrderInfo);
});

test('NodeCatalog only accepts a DISCONNECT packet from the active process generation', () => {
  const { catalog, unregistrations, broadcasts } = createNodeCatalogForInfoTests();
  const node = catalog.processNodeInfo(
    remoteNodeInfo({
      instanceID: 'metrics-current',
      instanceEpoch: instanceEpoch(2000, 1),
      seq: 1
    })
  );
  const broadcastsBeforeDisconnect = broadcasts.length;

  catalog.disconnected(node.id, false, {
    instanceID: 'metrics-old',
    instanceEpoch: instanceEpoch(1000, 1)
  });
  catalog.disconnected(node.id, false, { instanceID: 'metrics-legacy-old' });

  assert.equal(node.available, true);
  assert.deepEqual(unregistrations, []);
  assert.equal(broadcasts.length, broadcastsBeforeDisconnect);

  catalog.disconnected(node.id, false, {
    instanceID: 'metrics-current',
    instanceEpoch: instanceEpoch(2000, 1)
  });

  assert.equal(node.available, false);
  assert.deepEqual(unregistrations, [node.id]);
  assert.equal(broadcasts.at(-1)?.event, '$node.disconnected');
});

test('BaseDiscoverer applies the process-generation fence to HEARTBEAT packets', () => {
  const node = new Node('metrics-production-metrics');
  node.instanceID = 'metrics-current';
  node.instanceEpoch = instanceEpoch(2000, 1);
  node.seq = 5;
  node.cpu = 10;
  node.cpuSeq = 2;
  node.lastHeartbeatTime = 17;
  const { discoverer, discoveries } = createHeartbeatDiscoverer(node);

  discoverer.heartbeatReceived(node.id, {
    instanceID: 'metrics-old',
    instanceEpoch: instanceEpoch(1000, 1),
    cpu: 90,
    cpuSeq: 9
  });
  discoverer.heartbeatReceived(node.id, {
    instanceID: 'metrics-legacy-old',
    cpu: 80,
    cpuSeq: 8
  });

  assert.equal(node.cpu, 10);
  assert.equal(node.cpuSeq, 2);
  assert.equal(node.lastHeartbeatTime, 17);
  assert.deepEqual(discoveries, []);

  discoverer.heartbeatReceived(node.id, {
    instanceID: 'metrics-next',
    instanceEpoch: instanceEpoch(3000, 1),
    cpu: 70,
    cpuSeq: 7
  });

  assert.equal(node.cpu, 10);
  assert.deepEqual(discoveries, [node.id]);

  discoverer.heartbeatReceived(node.id, {
    instanceID: 'metrics-current',
    instanceEpoch: instanceEpoch(2000, 1),
    cpu: 20,
    cpuSeq: 3
  });

  assert.equal(node.cpu, 20);
  assert.equal(node.cpuSeq, 3);
  assert.equal(discoveries.length, 1);
});

test('Transit includes the active process generation in HEARTBEAT and DISCONNECT packets', async () => {
  const transit = Object.create(Transit.prototype) as Transit;
  const packets: Array<{ type: string; payload: Record<string, unknown> }> = [];
  transit.star = {
    instanceID: 'metrics-current',
    instanceEpoch: instanceEpoch(2000, 1)
  } as never;
  (transit as never as {
    publish(packet: { type: string; payload: Record<string, unknown> }): Promise<void>;
  }).publish = (packet) => {
    packets.push(packet);
    return Promise.resolve();
  };

  await transit.sendHeartbeat({ id: 'metrics-production-metrics', cpu: 20 } as never);
  await transit.sendDisconnectPacket();

  assert.deepEqual(
    packets.map((packet) => ({ type: packet.type, payload: packet.payload })),
    [
      {
        type: 'HEARTBEAT',
        payload: {
          cpu: 20,
          instanceID: 'metrics-current',
          instanceEpoch: instanceEpoch(2000, 1)
        }
      },
      {
        type: 'DISCONNECT',
        payload: {
          instanceID: 'metrics-current',
          instanceEpoch: instanceEpoch(2000, 1)
        }
      }
    ]
  );
});

test('ServiceCatalog removes remote services and their registered endpoints by node ID', () => {
  const catalog = Object.create(ServiceCatalog.prototype) as ServiceCatalog;
  const remoteService = { node: { id: 'remote-node' }, fullName: 'remote.service' };
  const localService = { node: { id: 'local-node' }, fullName: 'local.service' };
  const removedActions: unknown[] = [];
  const removedEvents: unknown[] = [];
  catalog.services = [remoteService, localService] as never;
  catalog.registry = {
    actions: {
      removeByService(service: unknown) {
        removedActions.push(service);
      }
    },
    events: {
      removeByService(service: unknown) {
        removedEvents.push(service);
      }
    }
  } as never;

  catalog.removeAllByNodeID('remote-node');

  assert.deepEqual(catalog.services, [localService]);
  assert.deepEqual(removedActions, [remoteService]);
  assert.deepEqual(removedEvents, [remoteService]);
});

test('action and event catalogs prune empty endpoint containers', () => {
  const actionCatalog = Object.create(ActionCatalog.prototype) as ActionCatalog;
  const actionList = {
    removeByService() {},
    removeByNodeID() {},
    count() {
      return 0;
    }
  };
  actionCatalog.actions = new Map([['remote.action', actionList as never]]);
  actionCatalog.remove('remote.action', 'remote-node');
  assert.equal(actionCatalog.actions.size, 0);

  const eventCatalog = Object.create(EventCatalog.prototype) as EventCatalog;
  const eventList = {
    name: 'remote.event',
    removeByService() {},
    removeByNodeID() {},
    count() {
      return 0;
    }
  };
  eventCatalog.events = [eventList as never];
  eventCatalog.remove('remote.event', 'remote-node');
  assert.equal(eventCatalog.events.length, 0);
});
