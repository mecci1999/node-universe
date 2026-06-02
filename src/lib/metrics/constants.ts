/**
 * 所有的指标信息
 */

export default {
  // METRIC TYPES

  TYPE_COUNTER: 'counter', // 数量
  TYPE_GAUGE: 'gauge', // 宽度
  TYPE_HISTOGRAM: 'histogram', // 直方图
  TYPE_INFO: 'info', // 信息

  // --- METRICREGISTRY METRICS ---

  UNIVERSE_METRICS_COMMON_COLLECT_TOTAL: 'universe.metrics.common.collect.total',
  UNIVERSE_METRICS_COMMON_COLLECT_TIME: 'universe.metrics.common.collect.time',

  // --- PROCESS METRICS ---

  PROCESS_ARGUMENTS: 'process.arguments', // 进程参数

  PROCESS_PID: 'process.pid',
  PROCESS_PPID: 'process.ppid',

  PROCESS_MEMORY_HEAP_SIZE_TOTAL: 'process.memory.heap.size.total', // 内存总大小 单位bytes
  PROCESS_MEMORY_HEAP_SIZE_USED: 'process.memory.heap.size.used', // 内存已使用量 单位bytes
  PROCESS_MEMORY_HEAP_UTILIZATION: 'process.memory.heap.utilization', // 堆内存使用率
  PROCESS_MEMORY_RSS: 'process.memory.rss', // 进程中真正被加载到物理内存中 单位bytes
  PROCESS_MEMORY_EXTERNAL: 'process.memory.external', // 内存拓展 单位bytes

  PROCESS_MEMORY_HEAP_SPACE_SIZE_TOTAL: 'process.memory.heap.space.size.total', // 内存空间总大小 单位bytes
  PROCESS_MEMORY_HEAP_SPACE_SIZE_USED: 'process.memory.heap.space.size.used', // 内容空间使用量 单位bytes
  PROCESS_MEMORY_HEAP_SPACE_SIZE_AVAILABLE: 'process.memory.heap.space.size.available', // 内存空间可用量 单位bytes
  PROCESS_MEMORY_HEAP_SPACE_SIZE_PHYSICAL: 'process.memory.heap.space.size.physical', // bytes

  PROCESS_MEMORY_HEAP_STAT_HEAP_SIZE_TOTAL: 'process.memory.heap.stat.heap.size.total', // bytes
  PROCESS_MEMORY_HEAP_STAT_EXECUTABLE_SIZE_TOTAL: 'process.memory.heap.stat.executable.size.total', // 进程内存堆统计可执行文件大小总和 bytes
  PROCESS_MEMORY_HEAP_STAT_PHYSICAL_SIZE_TOTAL: 'process.memory.heap.stat.physical.size.total', // bytes
  PROCESS_MEMORY_HEAP_STAT_AVAILABLE_SIZE_TOTAL: 'process.memory.heap.stat.available.size.total', // bytes
  PROCESS_MEMORY_HEAP_STAT_USED_HEAP_SIZE: 'process.memory.heap.stat.used.heap.size', // bytes
  PROCESS_MEMORY_HEAP_STAT_HEAP_SIZE_LIMIT: 'process.memory.heap.stat.heap.size.limit', // bytes
  PROCESS_MEMORY_HEAP_STAT_MALLOCATED_MEMORY: 'process.memory.heap.stat.mallocated.memory', // 进程内存堆可分配内存大小 bytes
  PROCESS_MEMORY_HEAP_STAT_PEAK_MALLOCATED_MEMORY: 'process.memory.heap.stat.peak.mallocated.memory', // bytes
  PROCESS_MEMORY_HEAP_STAT_ZAP_GARBAGE: 'process.memory.heap.stat.zap.garbage', // 进程内存垃圾回收

  PROCESS_UPTIME: 'process.uptime', // seconds
  PROCESS_INTERNAL_ACTIVE_HANDLES: 'process.internal.active.handles',
  PROCESS_INTERNAL_ACTIVE_REQUESTS: 'process.internal.active.requests',

  PROCESS_VERSIONS_NODE: 'process.versions.node', // 进程node版本

  // --- EVENT LOOP METRICS ---

  PROCESS_EVENTLOOP_LAG_MIN: 'process.eventloop.lag.min', // 处理事件循环最小延迟 msec
  PROCESS_EVENTLOOP_LAG_AVG: 'process.eventloop.lag.avg', // 处理事件循环平均延迟 msec
  PROCESS_EVENTLOOP_LAG_MAX: 'process.eventloop.lag.max', // 处理事件循环最大延迟 msec
  PROCESS_EVENTLOOP_LAG_COUNT: 'process.eventloop.lag.count',

  // --- GARBAGE COLLECTOR METRICS ---

  PROCESS_GC_TIME: 'process.gc.time', // 进程垃圾回收花费时间 nanoseconds
  PROCESS_GC_TOTAL_TIME: 'process.gc.total.time', // 进程垃圾回收总花费时间 milliseconds
  PROCESS_GC_EXECUTED_TOTAL: 'process.gc.executed.total', // 进程垃圾完成回收数量

  // --- OS METRICS ---

  OS_MEMORY_FREE: 'os.memory.free', // bytes
  OS_MEMORY_USED: 'os.memory.used', // bytes
  OS_MEMORY_TOTAL: 'os.memory.total', // bytes
  OS_MEMORY_UTILIZATION: 'os.memory.utilization',
  OS_UPTIME: 'os.uptime', // seconds
  OS_TYPE: 'os.type',
  OS_RELEASE: 'os.release',
  OS_HOSTNAME: 'os.hostname',
  OS_ARCH: 'os.arch',
  OS_PLATFORM: 'os.platform',
  OS_USER_UID: 'os.user.uid',
  OS_USER_GID: 'os.user.gid',
  OS_USER_USERNAME: 'os.user.username',
  OS_USER_HOMEDIR: 'os.user.homedir',

  OS_DATETIME_UNIX: 'os.datetime.unix',
  OS_DATETIME_ISO: 'os.datetime.iso',
  OS_DATETIME_UTC: 'os.datetime.utc',
  OS_DATETIME_TZ_OFFSET: 'os.datetime.tz.offset',

  OS_NETWORK_ADDRESS: 'os.network.address',
  OS_NETWORK_MAC: 'os.network.mac',

  OS_CPU_LOAD_1: 'os.cpu.load.1',
  OS_CPU_LOAD_5: 'os.cpu.load.5',
  OS_CPU_LOAD_15: 'os.cpu.load.15',
  OS_CPU_UTILIZATION: 'os.cpu.utilization',

  OS_CPU_USER: 'os.cpu.user', // seconds
  OS_CPU_SYSTEM: 'os.cpu.system', // seconds

  OS_CPU_TOTAL: 'os.cpu.total',
  OS_CPU_INFO_MODEL: 'os.cpu.info.model',
  OS_CPU_INFO_SPEED: 'os.cpu.info.speed',
  OS_CPU_INFO_TIMES_USER: 'os.cpu.info.times.user',
  OS_CPU_INFO_TIMES_SYS: 'os.cpu.info.times.sys',

  // --- UNIVERSE NODE METRICS ---

  UNIVERSE_NODE_TYPE: 'universe.node.type',
  UNIVERSE_NODE_VERSIONS_UNIVERSE: 'universe.node.versions.universe',
  UNIVERSE_NODE_VERSIONS_LANG: 'universe.node.versions.lang',
  UNIVERSE_NODE_VERSIONS_PROTOCOL: 'universe.node.versions.protocol',

  // --- UNIVERSE STAR METRICS ---
  UNIVERSE_STAR_NAMESPACE: 'universe.star.namespace',
  UNIVERSE_STAR_STARTED: 'universe.star.started',
  UNIVERSE_STAR_LOCAL_SERVICES_TOTAL: 'universe.star.local.services.total',
  UNIVERSE_STAR_MIDDLEWARES_TOTAL: 'universe.star.middlewares.total',

  // --- UNIVERSE REGISTRY METRICS ---

  UNIVERSE_REGISTRY_NODES_TOTAL: 'universe.registry.nodes.total',
  UNIVERSE_REGISTRY_NODES_ONLINE_TOTAL: 'universe.registry.nodes.online.total',
  UNIVERSE_REGISTRY_SERVICES_TOTAL: 'universe.registry.services.total',
  UNIVERSE_REGISTRY_SERVICE_ENDPOINTS_TOTAL: 'universe.registry.service.endpoints.total',
  UNIVERSE_REGISTRY_ACTIONS_TOTAL: 'universe.registry.actions.total',
  UNIVERSE_REGISTRY_ACTION_ENDPOINTS_TOTAL: 'universe.registry.action.endpoints.total',
  UNIVERSE_REGISTRY_EVENTS_TOTAL: 'universe.registry.events.total',
  UNIVERSE_REGISTRY_EVENT_ENDPOINTS_TOTAL: 'universe.registry.event.endpoints.total',

  // --- UNIVERSE REQUEST METRICS ---

  UNIVERSE_REQUEST_TOTAL: 'universe.request.total',
  UNIVERSE_REQUEST_ACTIVE: 'universe.request.active',
  UNIVERSE_REQUEST_ERROR_TOTAL: 'universe.request.error.total',
  UNIVERSE_REQUEST_TIME: 'universe.request.time', // msec
  UNIVERSE_REQUEST_LEVELS: 'universe.request.levels',
  UNIVERSE_REQUEST_DIRECTCALL_TOTAL: 'universe.request.directcall.total',
  UNIVERSE_REQUEST_MULTICALL_TOTAL: 'universe.request.multicall.total',

  // UNIVERSE EVENTS METRICS ---

  UNIVERSE_EVENT_EMIT_TOTAL: 'universe.event.emit.total',
  UNIVERSE_EVENT_BROADCAST_TOTAL: 'universe.event.broadcast.total',
  UNIVERSE_EVENT_BROADCASTLOCAL_TOTAL: 'universe.event.broadcast_local.total',
  UNIVERSE_EVENT_RECEIVED_TOTAL: 'universe.event.received.total',
  UNIVERSE_EVENT_RECEIVED_ACTIVE: 'universe.event.received.active',
  UNIVERSE_EVENT_RECEIVED_ERROR_TOTAL: 'universe.event.received.error.total',
  UNIVERSE_EVENT_RECEIVED_TIME: 'universe.event.received.time', //msec

  // UNIVERSE TRANSIT METRICS ---

  UNIVERSE_TRANSIT_PUBLISH_TOTAL: 'universe.transit.publish.total',
  UNIVERSE_TRANSIT_RECEIVE_TOTAL: 'universe.transit.receive.total',

  UNIVERSE_TRANSIT_REQUESTS_ACTIVE: 'universe.transit.requests.active',
  UNIVERSE_TRANSIT_STREAMS_SEND_ACTIVE: 'universe.transit.streams.send.active',
  UNIVERSE_TRANSIT_STREAMS_RECEIVE_ACTIVE: 'universe.transit.streams.receive.active',
  UNIVERSE_TRANSIT_READY: 'universe.transit.ready', // true/false
  UNIVERSE_TRANSIT_CONNECTED: 'universe.transit.connected', // true/false

  UNIVERSE_TRANSIT_PONG_TIME: 'universe.transit.pong.time', // true/false
  UNIVERSE_TRANSIT_PONG_SYSTIME_DIFF: 'universe.transit.pong.systime_diff', // true/false

  UNIVERSE_TRANSIT_ORPHAN_RESPONSE_TOTAL: 'universe.transit.orphan.response.total',

  // --- UNIVERSE TRANSPORTER METRICS ---

  UNIVERSE_TRANSPORTER_PACKETS_SENT_TOTAL: 'universe.transporter.packets.sent.total',
  UNIVERSE_TRANSPORTER_PACKETS_SENT_BYTES: 'universe.transporter.packets.sent.bytes', // bytes
  UNIVERSE_TRANSPORTER_PACKETS_RECEIVED_TOTAL: 'universe.transporter.packets.received.total',
  UNIVERSE_TRANSPORTER_PACKETS_RECEIVED_BYTES: 'universe.transporter.packets.received.bytes', // bytes

  // --- UNIVERSE CIRCUIT STAR METRICS ---

  UNIVERSE_CIRCUIT_STAR_OPENED_ACTIVE: 'universe.circuit_star.opened.active',
  UNIVERSE_CIRCUIT_STAR_OPENED_TOTAL: 'universe.circuit_star.opened.total',
  UNIVERSE_CIRCUIT_STAR_HALF_OPENED_ACTIVE: 'universe.circuit_star.half_opened.active',

  // --- UNIVERSE FALLBACK METRICS ---

  UNIVERSE_REQUEST_FALLBACK_TOTAL: 'universe.request.fallback.total',

  // --- UNIVERSE BULKHEAD METRICS ---

  UNIVERSE_REQUEST_BULKHEAD_INFLIGHT: 'universe.request.bulkhead.inflight',
  UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE: 'universe.request.bulkhead.queue.size',

  UNIVERSE_EVENT_BULKHEAD_INFLIGHT: 'universe.event.bulkhead.inflight',
  UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE: 'universe.event.bulkhead.queue.size',

  // --- UNIVERSE RETRY METRICS ---

  UNIVERSE_REQUEST_RETRY_ATTEMPTS_TOTAL: 'universe.request.retry.attempts.total',

  // --- UNIVERSE TIMEOUT METRICS ---

  UNIVERSE_REQUEST_TIMEOUT_TOTAL: 'universe.request.timeout.total',

  // --- UNIVERSE CACHER METRICS ---

  UNIVERSE_CACHER_GET_TOTAL: 'universe.cacher.get.total',
  UNIVERSE_CACHER_GET_TIME: 'universe.cacher.get.time',
  UNIVERSE_CACHER_FOUND_TOTAL: 'universe.cacher.found.total',
  UNIVERSE_CACHER_SET_TOTAL: 'universe.cacher.set.total',
  UNIVERSE_CACHER_SET_TIME: 'universe.cacher.set.time',
  UNIVERSE_CACHER_DEL_TOTAL: 'universe.cacher.del.total',
  UNIVERSE_CACHER_DEL_TIME: 'universe.cacher.del.time',
  UNIVERSE_CACHER_CLEAN_TOTAL: 'universe.cacher.clean.total',
  UNIVERSE_CACHER_CLEAN_TIME: 'universe.cacher.clean.time',
  UNIVERSE_CACHER_EXPIRED_TOTAL: 'universe.cacher.expired.total',

  UNIVERSE_DISCOVERER_REDIS_COLLECT_TOTAL: 'universe.discoverer.redis.collect.total',
  UNIVERSE_DISCOVERER_REDIS_COLLECT_TIME: 'universe.discoverer.redis.collect.time',

  UNIVERSE_DISCOVERER_ETCD_COLLECT_TOTAL: 'universe.discoverer.etcd.collect.total',
  UNIVERSE_DISCOVERER_ETCD_COLLECT_TIME: 'universe.discoverer.etcd.collect.time',

  // --- COMMON UNITS ---

  // Bytes
  UNIT_BIT: 'bit',
  UNIT_BYTE: 'byte',
  UNIT_KILOBYTES: 'kilobyte',
  UNIT_MEGABYTE: 'megabyte',
  UNIT_GIGABYTE: 'gigabyte',
  UNIT_TERRABYTE: 'terrabyte',
  UNIT_PETABYTE: 'petabyte',
  UNIT_EXOBYTE: 'exabyte',

  // Time
  UNIT_NANOSECONDS: 'nanosecond',
  UNIT_MICROSECONDS: 'microsecond',
  UNIT_MILLISECONDS: 'millisecond',
  UNIT_SECONDS: 'second',
  UNIT_MINUTE: 'minute',
  UNIT_HOUR: 'hour',
  UNIT_DAY: 'day',
  UNIT_WEEK: 'week',
  UNIT_MONTH: 'month',
  UNIT_YEAR: 'year',

  // Process
  UNIT_HANDLE: 'handle',
  UNIT_CPU: 'cpu',
  UNIT_GHZ: 'GHz',

  // Network
  UNIT_REQUEST: 'request',
  UNIT_CONNECTION: 'connection',
  UNIT_PACKET: 'packet',
  UNIT_MESSAGE: 'message',
  UNIT_STREAM: 'stream',
  UNIT_EVENT: 'event'
};
