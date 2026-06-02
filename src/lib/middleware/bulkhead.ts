/**
 * 隔离中间件
 */

import Context from '../context';
import { QueueIsFullError } from '../error';
import { METRIC } from '../metrics';
import Star from '../star';

function bulkheadMiddleware(star: Star) {
  function wrapActionBulkheadMiddleware(handler: any, action: any) {
    const service = action.service;
    /* istanbul ignore next */
    const options = Object.assign({}, star.options.bulkhead || {}, action.bulkhead || {});

    if (options.enabled) {
      const queue: any[] = [];
      let currentInFlight = 0;

      // 使用递归，完成队列中的请求
      const callNext = () => {
        if (queue.length === 0) return;

        if (currentInFlight >= options?.concurrency) return;

        // 拿到队列的第一个元素
        const item = queue.shift();
        currentInFlight++;
        star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_INFLIGHT, currentInFlight, {
          action: action.name,
          service: service?.fullName || 'Unknown'
        });
        star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE, queue.length, {
          action: action.name,
          service: service?.fullName || 'Unknown'
        });

        handler(item.ctx)
          .then((res) => {
            currentInFlight--;
            star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_INFLIGHT, currentInFlight, {
              action: action.name,
              service: service?.fullName || 'Unknown'
            });
            star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE, queue.length, {
              action: action.name,
              service: service?.fullName || 'Unknown'
            });
            item.resolve(res);
            callNext();
          })
          .catch((err) => {
            currentInFlight--;
            star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_INFLIGHT, currentInFlight, {
              action: action.name,
              service: service?.fullName || 'Unknown'
            });
            star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE, queue.length, {
              action: action.name,
              service: service?.fullName || 'Unknown'
            });
            item.reject(err);
            callNext();
          });
      };

      return function bulkheadMiddleware(ctx: Context) {
        if (currentInFlight < options.concurrency) {
          currentInFlight++;
          star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_INFLIGHT, currentInFlight, {
            action: action.name,
            service: service?.fullName || 'Unknown'
          });
          star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE, queue.length, {
            action: action.name,
            service: service?.fullName || 'Unknown'
          });

          return handler(ctx)
            .then((res) => {
              currentInFlight--;
              star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_INFLIGHT, currentInFlight, {
                action: action.name,
                service: service?.fullName || 'Unknown'
              });
              star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE, queue.length, {
                action: action.name,
                service: service?.fullName || 'Unknown'
              });
              callNext();
              return res;
            })
            .catch((err) => {
              currentInFlight--;
              star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_INFLIGHT, currentInFlight, {
                action: action.name,
                service: service?.fullName || 'Unknown'
              });
              star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE, queue.length, {
                action: action.name,
                service: service?.fullName || 'Unknown'
              });
              callNext();
              return Promise.reject(err);
            });
        }

        // 队列已满
        if (options.maxQueueSize && queue.length >= options.maxQueueSize) {
          return Promise.reject(new QueueIsFullError({ action: ctx.action?.name, nodeID: ctx.nodeID || 'Unknown' }));
        }

        const p = new Promise((resolve, rejcet) => {
          return queue.push({ resolve, rejcet, ctx });
        });

        star.metrics?.set(METRIC.UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE, queue.length, {
          action: action.name,
          service: service?.fullName || 'Unknown'
        });

        return p;
      };
    }

    return handler;
  }

  function wrapEventBulkheadMiddleware(handler: any, event: any) {
    const service = event.service;
    const options = Object.assign({}, star.options.bulkhead || {}, event.bulkhead || {});

    if (options.enabled) {
      const queue: any[] = [];
      let currentInFlight = 0;

      // 使用递归，完成队列中的请求
      const callNext = () => {
        if (queue.length === 0) return;

        if (currentInFlight >= options?.concurrency) return;

        // 拿到队列的第一个元素
        const item = queue.shift();
        currentInFlight++;
        star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_INFLIGHT, currentInFlight, {
          action: event.name,
          service: service?.fullName || 'Unknown'
        });
        star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE, queue.length, {
          action: event.name,
          service: service?.fullName || 'Unknown'
        });

        handler(item.ctx)
          .then((res) => {
            currentInFlight--;
            star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_INFLIGHT, currentInFlight, {
              action: event.name,
              service: service?.fullName || 'Unknown'
            });
            star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE, queue.length, {
              action: event.name,
              service: service?.fullName || 'Unknown'
            });
            item.resolve(res);
            callNext();
          })
          .catch((err) => {
            currentInFlight--;
            star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_INFLIGHT, currentInFlight, {
              action: event.name,
              service: service?.fullName || 'Unknown'
            });
            star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE, queue.length, {
              action: event.name,
              service: service?.fullName || 'Unknown'
            });
            item.reject(err);
            callNext();
          });
      };

      return function bulkheadMiddleware(ctx: Context) {
        if (currentInFlight < options.concurrency) {
          currentInFlight++;
          star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_INFLIGHT, currentInFlight, {
            action: event.name,
            service: service?.fullName || 'Unknown'
          });
          star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE, queue.length, {
            action: event.name,
            service: service?.fullName || 'Unknown'
          });

          return handler(ctx)
            .then((res) => {
              currentInFlight--;
              star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_INFLIGHT, currentInFlight, {
                action: event.name,
                service: service?.fullName || 'Unknown'
              });
              star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE, queue.length, {
                action: event.name,
                service: service?.fullName || 'Unknown'
              });
              callNext();
              return res;
            })
            .catch((err) => {
              currentInFlight--;
              star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_INFLIGHT, currentInFlight, {
                action: event.name,
                service: service?.fullName || 'Unknown'
              });
              star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE, queue.length, {
                action: event.name,
                service: service?.fullName || 'Unknown'
              });
              callNext();
              return Promise.reject(err);
            });
        }

        // 队列已满
        if (options.maxQueueSize && queue.length >= options.maxQueueSize) {
          return Promise.reject(new QueueIsFullError({ action: ctx.action?.name, nodeID: ctx.nodeID || 'Unknown' }));
        }

        const p = new Promise((resolve, rejcet) => {
          return queue.push({ resolve, rejcet, ctx });
        });

        star.metrics?.set(METRIC.UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE, queue.length, {
          action: event.name,
          service: service?.fullName || 'Unknown'
        });

        return p;
      };
    }

    return handler;
  }

  return {
    name: 'Bulkhead',
    created() {
      if (star.isMetricsEnabled()) {
        star.metrics?.register({
          name: METRIC.UNIVERSE_REQUEST_BULKHEAD_INFLIGHT,
          type: METRIC.TYPE_GAUGE,
          labelNames: ['action', 'service'],
          description: '当前正在执行的隔离动作请求数量'
        });
        star.metrics?.register({
          name: METRIC.UNIVERSE_REQUEST_BULKHEAD_QUEUE_SIZE,
          type: METRIC.TYPE_GAUGE,
          labelNames: ['action', 'service'],
          description: '当前等待执行的隔离动作请求队列长度'
        });
        star.metrics?.register({
          name: METRIC.UNIVERSE_EVENT_BULKHEAD_INFLIGHT,
          type: METRIC.TYPE_GAUGE,
          labelNames: ['action', 'service'],
          description: '当前正在执行的隔离事件处理数量'
        });
        star.metrics?.register({
          name: METRIC.UNIVERSE_EVENT_BULKHEAD_QUEUE_SIZE,
          type: METRIC.TYPE_GAUGE,
          labelNames: ['action', 'service'],
          description: '当前等待执行的隔离事件处理队列长度'
        });
      }
    },
    localAction: wrapActionBulkheadMiddleware,
    localEvent: wrapEventBulkheadMiddleware
  };
}

export default bulkheadMiddleware;
