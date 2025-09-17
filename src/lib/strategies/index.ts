import BaseStrategy from './base';
import RoundRobinStrategy from './round-robin';
import RandomStrategy from './random';
import CpuUsageStrategy from './cpu-usage';
import LatencyStrategy from './latency';
import ShardStrategy from './shard';
import WeightedRoundRobinStrategy from './weighted-round-robin';
import LeastConnectionsStrategy from './least-connections';
import ConsistentHashingStrategy from './consistent-hashing';
import HealthCheckStrategy from './health-check';
import IPHashStrategy from './ip-hash';
import LeastResponseTimeStrategy from './least-response-time';
import { isObject, isString } from '@/utils';
import { StarOptionsError } from '../error';

/**
 * 通信策略模块
 */
const strategies = {
  RoundRobin: RoundRobinStrategy,
  Random: RandomStrategy,
  CpuUsage: CpuUsageStrategy,
  Latency: LatencyStrategy,
  Shard: ShardStrategy,
  WeightedRoundRobin: WeightedRoundRobinStrategy,
  LeastConnections: LeastConnectionsStrategy,
  ConsistentHashing: ConsistentHashingStrategy,
  HealthCheck: HealthCheckStrategy,
  IPHash: IPHashStrategy,
  LeastResponseTime: LeastResponseTimeStrategy
};

/**
 * 根据名称获取对应的类型实例
 * @param name 选择模块的名称
 */
function getByName(name: string) {
  if (!name) return null;

  let instanceName = Object.keys(strategies).find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (instanceName) return strategies[instanceName];
}

function resolve(options: object | string) {
  if (Object.prototype.isPrototypeOf.call(BaseStrategy, options)) {
    return options;
  } else if (isString(options)) {
    let StrategyClass = getByName(options as string);
    if (StrategyClass) return StrategyClass;
    else throw new StarOptionsError(`Invalid strategy type '${options}'.`, { type: options as any });
  } else if (isObject(options)) {
    let StrategyClass = getByName((options as any)?.type || 'RoundRobin');
    if (StrategyClass) return StrategyClass;
    else
      throw new StarOptionsError(`Invalid strategy type '${(options as any)?.type}'.`, {
        type: (options as any)?.type
      });
  }

  return strategies.RoundRobin;
}

function register(name: string, value: any) {
  strategies[name] = value;
}

export default Object.assign(strategies, { resolve, register });
