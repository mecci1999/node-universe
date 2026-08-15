import assert from 'node:assert/strict';
import test from 'node:test';
import MetricRate from '@/lib/metrics/rates';
import TimeWindowQuantiles from '@/lib/metrics/type/histogram/timeWindowQuantiles';
import Transit from '@/lib/transit';
import NodeCatalog from '@/lib/registry/catalogs/node';
import ActionCatalog from '@/lib/registry/catalogs/action';
import EventCatalog from '@/lib/registry/catalogs/event';
import ServiceCatalog from '@/lib/registry/catalogs/service';
import { TransitRequest } from '@/typings/transit';

type ExpiringTransitRequest = TransitRequest & { timestamp: number };

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
