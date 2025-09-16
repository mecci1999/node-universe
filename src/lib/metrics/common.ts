import os from 'os';
import METRIC from './constants';
import { getCpuUsage } from '../star/cpu-usage';
import v8 from 'v8';
import MetricRegistry from './registry';
import { monitorEventLoopDelay } from 'monitor-event-loop-delay';
import { PerformanceObserver } from 'perf_hooks';

/**
 * 注册通用指标
 */
function registerCommonMetrics(registry: MetricRegistry) {
  registry.logger.debug('Registering common metrics...');

  // 注册指标
  registry.register({
    name: METRIC.UNIVERSE_METRICS_COMMON_COLLECT_TOTAL,
    type: METRIC.TYPE_COUNTER,
    description: '所有搜集的指标数量'
  });
  registry.register({
    name: METRIC.UNIVERSE_METRICS_COMMON_COLLECT_TIME,
    type: METRIC.TYPE_GAUGE,
    description: '搜集指标所需要的时间',
    unit: METRIC.UNIT_MILLISECONDS
  });

  // ------进程相关指标------

  const process_arguments = registry.register({
    name: METRIC.PROCESS_ARGUMENTS,
    type: METRIC.TYPE_INFO,
    labelNames: ['index'],
    desciption: '进程相关参数'
  });

  process.argv.map((arg, index) => {
    if (process_arguments) {
      process_arguments.set(arg, { index });
    }
  });

  const process_pid = registry.register({
    name: METRIC.PROCESS_PID,
    type: METRIC.TYPE_INFO,
    description: '进程的PID'
  });
  process_pid?.set(process.pid);

  const process_ppid = registry.register({
    name: METRIC.PROCESS_PPID,
    type: METRIC.TYPE_INFO,
    description: '进程的PPID'
  });
  process_ppid?.set(process.ppid);

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_SIZE_TOTAL,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程堆内存大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_SIZE_USED,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程已使用堆内存大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_RSS,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程真正被加载到的物理内存大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_EXTERNAL,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程拓展内存大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_SPACE_SIZE_TOTAL,
    type: METRIC.TYPE_GAUGE,
    labelNames: ['space'],
    unit: METRIC.UNIT_BYTE,
    description: '进程所有的堆空间大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_SPACE_SIZE_USED,
    type: METRIC.TYPE_GAUGE,
    labelNames: ['space'],
    unit: METRIC.UNIT_BYTE,
    description: '进程已使用的堆空间大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_SPACE_SIZE_AVAILABLE,
    type: METRIC.TYPE_GAUGE,
    labelNames: ['space'],
    unit: METRIC.UNIT_BYTE,
    description: '进程可用的堆空间大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_SPACE_SIZE_PHYSICAL,
    type: METRIC.TYPE_GAUGE,
    labelNames: ['space'],
    unit: METRIC.UNIT_BYTE,
    description: '进程物理的堆空间大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_HEAP_SIZE_TOTAL,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程内存堆静态堆大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_EXECUTABLE_SIZE_TOTAL,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程内存堆静态可执行大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_PHYSICAL_SIZE_TOTAL,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程内存堆静态物理大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_AVAILABLE_SIZE_TOTAL,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程内存堆静态可使用大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_USED_HEAP_SIZE,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程堆状态使用的大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_HEAP_SIZE_LIMIT,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程堆状态大小限制'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_MALLOCATED_MEMORY,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程堆统计错误定位的大小'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_PEAK_MALLOCATED_MEMORY,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '进程堆状态错置大小的峰值'
  });

  registry.register({
    name: METRIC.PROCESS_MEMORY_HEAP_STAT_ZAP_GARBAGE,
    type: METRIC.TYPE_GAUGE,
    description: '进程堆静态垃圾回收'
  });

  registry.register({
    name: METRIC.PROCESS_UPTIME,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_SECONDS,
    description: '进程更新时间'
  });

  registry.register({
    name: METRIC.PROCESS_INTERNAL_ACTIVE_HANDLES,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_HANDLE,
    description: '正在活动的程序数量'
  });

  registry.register({
    name: METRIC.PROCESS_INTERNAL_ACTIVE_REQUESTS,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_REQUEST,
    description: '正在活动的请求数量'
  });

  registry
    .register({
      name: METRIC.PROCESS_VERSIONS_NODE,
      type: METRIC.TYPE_INFO,
      description: '节点版本号'
    })
    ?.set(process.versions.node);

  // ------系统相关指标------

  registry.register({
    name: METRIC.OS_MEMORY_FREE,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '系统闲置内存大小'
  });

  registry.register({
    name: METRIC.OS_MEMORY_USED,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '系统已使用内存大小'
  });

  registry.register({
    name: METRIC.OS_MEMORY_TOTAL,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_BYTE,
    description: '系统总内存大小'
  });

  registry.register({
    name: METRIC.OS_UPTIME,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_SECONDS,
    description: '系统更新时间'
  });

  registry
    .register({
      name: METRIC.OS_TYPE,
      type: METRIC.TYPE_INFO,
      description: '系统类型'
    })
    ?.set(os.type());

  registry
    .register({
      name: METRIC.OS_RELEASE,
      type: METRIC.TYPE_INFO,
      description: '操作系统版本'
    })
    ?.set(os.release());

  registry
    .register({
      name: METRIC.OS_HOSTNAME,
      type: METRIC.TYPE_INFO,
      description: '系统主机名'
    })
    ?.set(os.hostname());

  registry
    .register({
      name: METRIC.OS_ARCH,
      type: METRIC.TYPE_INFO,
      description: '系统线程架构'
    })
    ?.set(os.arch());

  registry
    .register({
      name: METRIC.OS_PLATFORM,
      type: METRIC.TYPE_INFO,
      description: '操作系统平台'
    })
    ?.set(os.platform());

  const userInfo = getUserInfo();

  registry
    .register({
      name: METRIC.OS_USER_UID,
      type: METRIC.TYPE_INFO,
      description: 'UID'
    })
    ?.set((userInfo as os.UserInfo<string>)?.uid);

  registry
    .register({
      name: METRIC.OS_USER_GID,
      type: METRIC.TYPE_INFO,
      description: 'GID'
    })
    ?.set((userInfo as os.UserInfo<string>)?.gid);

  registry
    .register({
      name: METRIC.OS_USER_USERNAME,
      type: METRIC.TYPE_INFO,
      description: '用户名'
    })
    ?.set((userInfo as os.UserInfo<string>)?.username);

  registry
    .register({
      name: METRIC.OS_USER_HOMEDIR,
      type: METRIC.TYPE_INFO,
      description: '根目录'
    })
    ?.set((userInfo as os.UserInfo<string>)?.homedir);

  registry.register({
    name: METRIC.OS_NETWORK_ADDRESS,
    type: METRIC.TYPE_INFO,
    labelNames: ['interface', 'family'],
    description: '网络地址'
  });

  registry.register({
    name: METRIC.OS_NETWORK_MAC,
    type: METRIC.TYPE_INFO,
    labelNames: ['interface', 'family'],
    description: 'MAC地址'
  });

  registry.register({
    name: METRIC.OS_DATETIME_UNIX,
    type: METRIC.TYPE_GAUGE,
    description: '系统当前日期时间格式'
  });

  registry.register({
    name: METRIC.OS_DATETIME_ISO,
    type: METRIC.TYPE_INFO,
    description: '镜像当前日期时间'
  });

  registry.register({
    name: METRIC.OS_DATETIME_UTC,
    type: METRIC.TYPE_INFO,
    description: '当前UTC时间格式'
  });

  registry.register({
    name: METRIC.OS_DATETIME_TZ_OFFSET,
    type: METRIC.TYPE_GAUGE,
    description: '时区偏移'
  });

  registry.register({
    name: METRIC.OS_CPU_LOAD_1,
    type: METRIC.TYPE_GAUGE,
    description: 'CPU load1'
  });

  registry.register({
    name: METRIC.OS_CPU_LOAD_5,
    type: METRIC.TYPE_GAUGE,
    description: 'CPU load5'
  });

  registry.register({
    name: METRIC.OS_CPU_LOAD_15,
    type: METRIC.TYPE_GAUGE,
    description: 'CPU load15'
  });

  registry.register({
    name: METRIC.OS_CPU_UTILIZATION,
    type: METRIC.TYPE_GAUGE,
    description: 'CPU利用率'
  });

  registry.register({
    name: METRIC.OS_CPU_USER,
    type: METRIC.TYPE_GAUGE,
    description: 'CPU用户'
  });

  registry.register({
    name: METRIC.OS_CPU_SYSTEM,
    type: METRIC.TYPE_GAUGE,
    description: 'CPU系统'
  });

  registry.register({
    name: METRIC.OS_CPU_TOTAL,
    type: METRIC.TYPE_GAUGE,
    unit: METRIC.UNIT_CPU,
    description: 'CPU数量'
  });

  registry.register({
    name: METRIC.OS_CPU_INFO_MODEL,
    type: METRIC.TYPE_INFO,
    labelNames: ['index'],
    description: 'CPU模型'
  });

  registry.register({
    name: METRIC.OS_CPU_INFO_SPEED,
    type: METRIC.TYPE_GAUGE,
    labelNames: ['index'],
    unit: METRIC.UNIT_GHZ,
    description: 'CPU速度'
  });

  registry.register({
    name: METRIC.OS_CPU_INFO_TIMES_USER,
    type: METRIC.TYPE_GAUGE,
    labelNames: ['index'],
    description: 'CPU用户时间'
  });

  registry.register({
    name: METRIC.OS_CPU_INFO_TIMES_SYS,
    type: METRIC.TYPE_GAUGE,
    labelNames: ['index'],
    description: 'CPU系统时间'
  });

  startGCWatcher(registry);
  startEventLoopStats(registry);

  registry.logger.debug(`Registered ${registry.store.size} common metrics.`);
}

/**
 * 开启垃圾回收监听器（使用Performance API）
 */
function startGCWatcher(registry: MetricRegistry) {
  try {
    // 注册垃圾回收相关指标
    registry.register({
      name: METRIC.PROCESS_GC_TIME,
      type: METRIC.TYPE_GAUGE,
      unit: METRIC.UNIT_MILLISECONDS,
      description: '垃圾回收时间'
    });

    registry.register({
      name: METRIC.PROCESS_GC_TOTAL_TIME,
      type: METRIC.TYPE_COUNTER,
      unit: METRIC.UNIT_MILLISECONDS,
      description: '所有的垃圾回收花费时间'
    });

    registry.register({
      name: METRIC.PROCESS_GC_EXECUTED_TOTAL,
      type: METRIC.TYPE_COUNTER,
      labelNames: ['type'],
      description: '执行垃圾回收的数量'
    });

    // 使用Performance API监控GC事件
    const obs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        if (entry.entryType === 'gc') {
          const gcEntry = entry as any;
          const duration = gcEntry.duration;
          
          // 设置当前GC时间
          registry.set(METRIC.PROCESS_GC_TIME, duration);
          
          // 累加总GC时间
          registry.increment(METRIC.PROCESS_GC_TOTAL_TIME, null, duration);
          
          // 根据GC类型增加计数
          const gcType = gcEntry.kind || 'unknown';
          registry.increment(METRIC.PROCESS_GC_EXECUTED_TOTAL, { type: gcType });
        }
      }
    });
    
    // 开始观察GC事件
    obs.observe({ entryTypes: ['gc'] });
    
    registry.logger.debug('GC monitoring started using Performance API');
  } catch (error) {
    registry.logger.warn('Failed to initialize GC stats monitoring:', error);
    // 如果Performance API不可用，使用基本的堆内存监控作为备选方案
    startAlternativeHeapMonitoring(registry);
  }
}

/**
 * 替代的堆内存监控方案（适用于Node.js v22+）
 */
function startAlternativeHeapMonitoring(registry: MetricRegistry) {
  try {
    // 注册基本堆内存指标
     registry.register({
       name: METRIC.PROCESS_MEMORY_HEAP_SIZE_USED,
       type: METRIC.TYPE_GAUGE,
       unit: METRIC.UNIT_BYTE,
       description: '进程内存堆已使用大小'
     });
 
     registry.register({
       name: METRIC.PROCESS_MEMORY_HEAP_SIZE_TOTAL,
       type: METRIC.TYPE_GAUGE,
       unit: METRIC.UNIT_BYTE,
       description: '进程内存堆总大小'
     });
 
     // 使用定时器定期更新堆内存统计
     const heapStatsInterval = setInterval(() => {
       try {
         const heapStats = v8.getHeapStatistics();
         registry.set(METRIC.PROCESS_MEMORY_HEAP_SIZE_USED, heapStats.used_heap_size);
         registry.set(METRIC.PROCESS_MEMORY_HEAP_SIZE_TOTAL, heapStats.total_heap_size);
       } catch (err) {
         registry.logger.warn('Failed to collect heap statistics:', err);
       }
     }, 5000); // 每5秒更新一次
 
     registry.logger.info('Alternative heap monitoring started (Node.js v22+ compatible)');
   } catch (error) {
     registry.logger.warn('Failed to start alternative heap monitoring:', error);
   }
 }

let eventLoopMonitor: any = null;

function startEventLoopStats(registry: MetricRegistry) {
  try {
    registry.register({
      name: METRIC.PROCESS_EVENTLOOP_LAG_MIN,
      type: METRIC.TYPE_GAUGE,
      unit: METRIC.UNIT_MILLISECONDS,
      description: '事件循环最小时间'
    });
    registry.register({
      name: METRIC.PROCESS_EVENTLOOP_LAG_AVG,
      type: METRIC.TYPE_GAUGE,
      unit: METRIC.UNIT_MILLISECONDS,
      description: '事件循环平均时间'
    });
    registry.register({
      name: METRIC.PROCESS_EVENTLOOP_LAG_MAX,
      type: METRIC.TYPE_GAUGE,
      unit: METRIC.UNIT_MILLISECONDS,
      description: '事件循环最大时间'
    });
    registry.register({
      name: METRIC.PROCESS_EVENTLOOP_LAG_COUNT,
      type: METRIC.TYPE_GAUGE,
      description: '事件循环延迟数量'
    });

    // 初始化事件循环监控器
    eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
    eventLoopMonitor.enable();
  } catch (error) {
    // silent
  }
}

/**
 * 获取用户信息
 */
function getUserInfo() {
  try {
    return os.userInfo();
  } catch (error) {
    return {};
  }
}

/**
 * 更新通用指标数据
 */
function updateCommonMetrics(registry: MetricRegistry) {
  // registry.logger.debug('Update common metric values...');
  const end = registry.timer();

  // 获取进程内容相关情况
  const procMem = process.memoryUsage();

  registry.set(METRIC.PROCESS_MEMORY_HEAP_SIZE_TOTAL, procMem.heapTotal);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_SIZE_USED, procMem.heapUsed);
  registry.set(METRIC.PROCESS_MEMORY_RSS, procMem.rss);
  registry.set(METRIC.PROCESS_MEMORY_EXTERNAL, procMem.external);

  // 获取堆空间静态数据
  const stat = v8.getHeapSpaceStatistics();
  stat.forEach((item) => {
    const space = item.space_name;
    registry.set(METRIC.PROCESS_MEMORY_HEAP_SPACE_SIZE_TOTAL, item.space_size, { space });
    registry.set(METRIC.PROCESS_MEMORY_HEAP_SPACE_SIZE_USED, item.space_used_size, { space });
    registry.set(METRIC.PROCESS_MEMORY_HEAP_SPACE_SIZE_AVAILABLE, item.space_available_size, { space });
    registry.set(METRIC.PROCESS_MEMORY_HEAP_SPACE_SIZE_PHYSICAL, item.physical_space_size, { space });
  });

  const heapStat = v8.getHeapStatistics();
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_HEAP_SIZE_TOTAL, heapStat.total_heap_size);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_EXECUTABLE_SIZE_TOTAL, heapStat.total_heap_size_executable);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_PHYSICAL_SIZE_TOTAL, heapStat.total_physical_size);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_AVAILABLE_SIZE_TOTAL, heapStat.total_available_size);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_USED_HEAP_SIZE, heapStat.used_heap_size);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_HEAP_SIZE_LIMIT, heapStat.heap_size_limit);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_MALLOCATED_MEMORY, heapStat.malloced_memory);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_PEAK_MALLOCATED_MEMORY, heapStat.peak_malloced_memory);
  registry.set(METRIC.PROCESS_MEMORY_HEAP_STAT_ZAP_GARBAGE, heapStat.does_zap_garbage);

  registry.set(METRIC.PROCESS_UPTIME, process.uptime());
  registry.set(METRIC.PROCESS_INTERNAL_ACTIVE_HANDLES, (process as any)._getActiveHandles()?.length);
  registry.set(METRIC.PROCESS_INTERNAL_ACTIVE_REQUESTS, (process as any)._getActiveRequests()?.length);

  // ------ OS METRICS ------

  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const usedMem = totalMem - freeMem;

  registry.set(METRIC.OS_MEMORY_FREE, freeMem);
  registry.set(METRIC.OS_MEMORY_TOTAL, totalMem);
  registry.set(METRIC.OS_MEMORY_USED, usedMem);
  registry.set(METRIC.OS_UPTIME, os.uptime());
  registry.set(METRIC.OS_TYPE, os.type());
  registry.set(METRIC.OS_RELEASE, os.release());
  registry.set(METRIC.OS_HOSTNAME, os.hostname());
  registry.set(METRIC.OS_ARCH, os.arch());
  registry.set(METRIC.OS_PLATFORM, os.platform());

  // ------ NETWORK INTERFACES ------

  const getNetworkInterfaces = () => {
    const list: any[] = [];
    const ilist: any[] = [];
    const interfaces = os.networkInterfaces();

    for (let iface in interfaces) {
      for (let i in interfaces[iface]) {
        const f = interfaces[iface];
        if (f) {
          const value = f[i];
          if (value.internal) {
            ilist.push({ value, iface });
          } else {
            list.push({ value, iface });
          }
        }
      }
    }

    return list.length > 0 ? list : ilist;
  };

  const networkInterface = getNetworkInterfaces();

  for (let { value, iface } of networkInterface) {
    registry.set(METRIC.OS_NETWORK_ADDRESS, value.address, { interface: iface, family: value.family });
    registry.set(METRIC.OS_NETWORK_MAC, value.mac, { interface: iface, family: value.family });
  }

  const d = new Date();
  registry.set(METRIC.OS_DATETIME_UNIX, d.valueOf());
  registry.set(METRIC.OS_DATETIME_ISO, d.toISOString());
  registry.set(METRIC.OS_DATETIME_UTC, d.toUTCString());
  registry.set(METRIC.OS_DATETIME_TZ_OFFSET, d.getTimezoneOffset());

  const load = os.loadavg();
  registry.set(METRIC.OS_CPU_LOAD_1, load[0]);
  registry.set(METRIC.OS_CPU_LOAD_5, load[1]);
  registry.set(METRIC.OS_CPU_LOAD_15, load[2]);

  if (eventLoopMonitor) {
    try {
      registry.set(METRIC.PROCESS_EVENTLOOP_LAG_MIN, eventLoopMonitor.min / 1000000); // 转换为毫秒
      registry.set(METRIC.PROCESS_EVENTLOOP_LAG_AVG, eventLoopMonitor.mean / 1000000); // 转换为毫秒
      registry.set(METRIC.PROCESS_EVENTLOOP_LAG_MAX, eventLoopMonitor.max / 1000000); // 转换为毫秒
      registry.set(METRIC.PROCESS_EVENTLOOP_LAG_COUNT, eventLoopMonitor.count);
    } catch (error) {
      // silent
    }
  }

  const duration = end();

  return Promise.resolve().then(() => {
    getCpuUsage()
      .then((res) => {
        registry.set(METRIC.OS_CPU_UTILIZATION, res.avg);

        try {
          const cpus = os.cpus();
          registry.set(METRIC.OS_CPU_TOTAL, cpus.length);
          registry.set(
            METRIC.OS_CPU_USER,
            cpus.reduce((a, b) => a + b.times.user, 0)
          );
          registry.set(
            METRIC.OS_CPU_USER,
            cpus.reduce((a, b) => a + b.times.sys, 0)
          );

          cpus.forEach((cpu, index) => {
            registry.set(METRIC.OS_CPU_INFO_MODEL, cpu.model, { index });
            registry.set(METRIC.OS_CPU_INFO_SPEED, cpu.speed, { index });
            registry.set(METRIC.OS_CPU_INFO_TIMES_USER, cpu.times.user, { index });
            registry.set(METRIC.OS_CPU_INFO_TIMES_SYS, cpu.times.sys, { index });
          });
        } catch (error) {
          // silent
        }
      })
      .catch((err) => {
        // silent
        registry.logger.warn('Unable to collect CPU usage metrics.', err);
      })
      .then(() => {
        // registry.logger.debug(`Collected common metric values in ${duration.toFixed(3)} msec.`);
      });
  });
}

export { registerCommonMetrics, updateCommonMetrics };
