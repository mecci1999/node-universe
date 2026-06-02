/**
 * 熔断器中间件
 */
import C from '../star/constants';
import { METRIC } from '../metrics';
import Context from '../context';
import { GenericObject } from '@/typings';
import Star from '../star';
import Endpoint from '../registry/endpoint/item';
import Service from '../star/service';

const circuitBreakerMiddleware = (star: Star) => {
  let windowTimer: any;
  const store = new Map();
  let logger: any;

  /**
   * 创建清除定时器
   */
  function createWindowTimer(windowTime: number) {
    if (!windowTimer) {
      windowTimer = setInterval(() => resetStore(), (windowTime || 60) * 1000);
      windowTimer.unref();
    }
  }

  /**
   * 清除节点store
   */
  function resetStore() {
    if (!logger) return;

    logger.debug('Reset circuit-breaker endpoint states...');
    store.forEach((item, key) => {
      if (item.count == 0) {
        logger.debug(`Remove '${key}' endpoint state because it is not used`);
        store.delete(key);
        return;
      }

      logger.debug(`Clean '${key}' endpoint state.`);
      item.count = 0;
      item.failures = 0;
    });
  }

  /**
   * 从store中获取节点状态，如果不存在，创建一个
   */
  function getEpState(ep: Endpoint, service: Service, opts?: GenericObject) {
    let item = store.get(ep.name);
    if (!item) {
      item = {
        ep,
        service,
        opts,
        count: 0,
        failures: 0,
        state: C.CIRCUIT_CLOSE,
        cbTimer: null
      };
      store.set(ep.name, item);
    }
    return item;
  }

  /**
   * 增加失败请求数量
   */
  function failure(item: GenericObject, err: Error, ctx: Context) {
    item.count++;
    item.failures++;

    // 检查是否需要开启熔断器
    checkThreshold(item, ctx);
  }

  /**
   * 如果熔断器处于半开状态，逐步增加请求数量，进行健康检测，如果符合健康条件，则关闭熔断器
   *
   * @param {Object} item
   * @param {Context} ctx
   */
  function success(item: GenericObject, ctx: Context) {
    item.count++;

    if (item.state === C.CIRCUIT_HALF_OPEN_WAIT) circuitClose(item, ctx);
    else checkThreshold(item, ctx);
  }

  /**
   * 检查节点失败次数是否达到熔断器阈值
   *
   * @param {Object} item
   * @param {Context} ctx
   */
  function checkThreshold(item: GenericObject, ctx: Context) {
    if (item.count >= item.opts.minRequestCount) {
      const rate = item.failures / item.count;
      if (rate >= item.opts.threshold) trip(item, ctx);
    }
  }

  /**
   * 启动熔断机制
   *
   * @param {Object} item
   * @param {Context} ctx
   */
  function trip(item: GenericObject, ctx: Context) {
    if (item.state == C.CIRCUIT_OPEN) return;

    item.state = C.CIRCUIT_OPEN;
    item.ep.state = false;

    if (item.cbTimer) {
      clearTimeout(item.cbTimer);
      item.cbTimer = null;
    }

    item.cbTimer = setTimeout(() => halfOpen(item, ctx), item.opts.halfOpenTime);
    item.cbTimer.unref();

    const action = item.ep.action;
    const service = item.service.fullName;

    const rate = item.count > 0 ? item.failures / item.count : 0;
    logger.debug(`Circuit breaker has been opened on '${item.ep.name}' endpoint.`, {
      nodeID: item.ep.id,
      service,
      action: action.name,
      failures: item.failures,
      count: item.count,
      rate
    });
    star.broadcast('$circuit-breaker.opened', {
      nodeID: item.ep.id,
      service,
      action: action.name,
      failures: item.failures,
      count: item.count,
      rate
    });

    star.metrics?.set(METRIC.UNIVERSE_CIRCUIT_STAR_OPENED_ACTIVE, 1, {
      affectedNodeID: item.ep.id,
      service,
      action: action.name
    });
    star.metrics?.increment(METRIC.UNIVERSE_CIRCUIT_STAR_OPENED_TOTAL, {
      affectedNodeID: item.ep.id,
      service,
      action: action.name
    });
  }

  /**
   * 改变熔断器状态为半开状态
   *
   * @param {Object} item
   * @param {Context} ctx
   */
  function halfOpen(item: GenericObject, ctx?: Context) {
    item.state = C.CIRCUIT_HALF_OPEN;
    item.ep.state = true;

    const action = item.ep.action;
    const service = item.service.fullName;

    logger.debug(`Circuit breaker has been half-opened on '${item.ep.name}' endpoint.`, {
      nodeID: item.ep.id,
      service,
      action: action.name
    });

    star.broadcast('$circuit-breaker.half-opened', {
      nodeID: item.ep.id,
      service,
      action: action.name
    });

    star.metrics?.set(METRIC.UNIVERSE_CIRCUIT_STAR_OPENED_ACTIVE, 0, {
      affectedNodeID: item.ep.id,
      service,
      action: action.name
    });
    star.metrics?.set(METRIC.UNIVERSE_CIRCUIT_STAR_HALF_OPENED_ACTIVE, 1, {
      affectedNodeID: item.ep.id,
      service,
      action: action.name
    });

    if (item.cbTimer) {
      clearTimeout(item.cbTimer);
      item.cbTimer = null;
    }
  }

  /**
   * 改变熔断器状态至半开状态
   */
  function halfOpenWait(item: GenericObject, ctx: Context) {
    item.state = C.CIRCUIT_HALF_OPEN_WAIT;
    item.ep.state = false;

    // Anti-stick protection
    item.cbTimer = setTimeout(() => halfOpen(item, ctx), item.opts.halfOpenTime);
    item.cbTimer.unref();
  }

  /**
   * 关闭熔断器
   *
   * @param {Object} item
   * @param {Context} ctx
   */
  function circuitClose(item: GenericObject, ctx?: Context) {
    item.state = C.CIRCUIT_CLOSE;
    item.ep.state = true;
    item.failures = 0;
    item.count = 0;

    const action = item.ep.action;
    const service = item.service.fullName;

    logger.debug(`Circuit breaker has been closed on '${item.ep.name}' endpoint.`, {
      nodeID: item.ep.id,
      service,
      action: action.name
    });

    star.broadcast('$circuit-breaker.closed', {
      nodeID: item.ep.id,
      service,
      action: action.name
    });

    star.metrics?.set(METRIC.UNIVERSE_CIRCUIT_STAR_OPENED_ACTIVE, 0, {
      affectedNodeID: item.ep.id,
      service,
      action: action.name
    });
    star.metrics?.set(METRIC.UNIVERSE_CIRCUIT_STAR_HALF_OPENED_ACTIVE, 0, {
      affectedNodeID: item.ep.id,
      service,
      action: action.name
    });

    if (item.cbTimer) {
      clearTimeout(item.cbTimer);
      item.cbTimer = null;
    }
  }

  const wrapCBMiddleware = (handler: any, action: any) => {
    const service = action.service;
    // Merge action option and star options
    const opts = Object.assign({}, star.options.circuitBreaker || {}, action.circuitBreaker || {});
    if (opts.enabled) {
      return function circuitBreakerMiddleware(ctx: any) {
        // Get endpoint state item
        const ep = ctx.endpoint;
        const item = getEpState(ep, service, opts);

        // Handle half-open state in circuit breaker
        if (item.state == C.CIRCUIT_HALF_OPEN) {
          halfOpenWait(item, ctx);
        }

        // Call the handler
        return handler(ctx)
          .then((res) => {
            const item = getEpState(ep, service, opts);
            success(item, ctx);

            return res;
          })
          .catch((err) => {
            if (opts.check && opts.check(err)) {
              // Failure if error is created locally (not came from a 3rd node error)
              if (item && (!err.nodeID || err.nodeID == ctx.nodeID)) {
                const item = getEpState(ep, service, opts);
                failure(item, err, ctx);
              }
            }

            return Promise.reject(err);
          });
      };
    }

    return handler;
  };

  return {
    name: 'CircuitBreaker',

    created(star: any) {
      // 日志模块构建
      logger = star.getLogger('circuit-breaker');

      // Expose the internal state store.
      star.CircuitBreakerStore = store;

      const opts = star.options.circuitBreaker;

      // 是否开启了熔断机制
      if (opts.enabled) {
        createWindowTimer(opts.windowTime);

        if (star.isMetricsEnabled()) {
          star.metrics.register({
            name: METRIC.UNIVERSE_CIRCUIT_STAR_OPENED_ACTIVE,
            type: METRIC.TYPE_GAUGE,
            labelNames: ['affectedNodeID', 'service', 'action'],
            description: '当前处于打开状态的熔断器数量'
          });
          star.metrics.register({
            name: METRIC.UNIVERSE_CIRCUIT_STAR_OPENED_TOTAL,
            type: METRIC.TYPE_COUNTER,
            labelNames: ['affectedNodeID', 'service', 'action'],
            description: '熔断器进入打开状态的累计次数'
          });
          star.metrics.register({
            name: METRIC.UNIVERSE_CIRCUIT_STAR_HALF_OPENED_ACTIVE,
            type: METRIC.TYPE_GAUGE,
            labelNames: ['affectedNodeID', 'service', 'action'],
            description: '当前处于半开状态的熔断器数量'
          });
        }
      }
    },

    localAction: wrapCBMiddleware,
    remoteAction: wrapCBMiddleware,

    stopped() {
      if (windowTimer) {
        clearInterval(windowTimer);
      }

      delete (star as any).CircuitBreakerStore;
    }
  };
};

export default circuitBreakerMiddleware;
