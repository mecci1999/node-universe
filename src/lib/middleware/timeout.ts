import promiseTimeout from '@/utils/promiseTimeout';
import Context from '../context';
import { RequestTimeoutError } from '../error/custom';
import { METRIC } from '../metrics';
import Star from '../star';

/**
 * 超时处理
 */
export default function (star: Star) {
  function wrapTimeoutMiddleware(handler: any, action: any) {
    const actionTimeout = action?.timeout;
    const actionName = action?.name;
    const service = action.service ? action.service.fullName : null;

    return function timeoutMiddleware(ctx: Context) {
      if (ctx.options.timeout == null) {
        if (actionTimeout != null) {
          ctx.options.timeout = actionTimeout;
        } else {
          ctx.options.timeout = star.options.requestTimeout;
        }
      }

      if ((ctx.options.timeout as number) > 0 && !ctx.starHrTime) {
        ctx.starHrTime = process.hrtime();
      }

      const p = handler(ctx) as Promise<any>;

      if ((ctx.options.timeout as number) > 0) {
        return promiseTimeout(p, ctx.options.timeout as number).catch((err) => {
          if (err) {
            const nodeID = ctx.nodeID;
            // 检查是否真的是超时错误
            const isTimeoutError =
              err.message === 'async function access timeout' || err.message === 'Action execution timed out';

            if (isTimeoutError) {
              star.logger?.warn(`Request '${actionName}' is timed out. Expected: ${ctx.options.timeout}ms`, {
                requestID: ctx.requestID,
                nodeID,
                timeout: ctx.options.timeout
              });
              err = new RequestTimeoutError({ action: actionName, nodeID: nodeID || 'Unknown' });
              star.metrics?.increment(METRIC.UNIVERSE_REQUEST_TIMEOUT_TOTAL, { service, action: actionName });
            } else {
              // 如果不是超时错误，打印真实的错误信息以便调试
              star.logger?.error(`Request '${actionName}' failed (not timeout). Error:`, err);
            }
          }

          throw err;
        });
      }

      return p;
    }.bind(star);
  }

  return {
    name: 'Timeout',
    created(star: Star) {
      if (star.isMetricsEnabled()) {
        star.metrics?.register({
          name: METRIC.UNIVERSE_REQUEST_TIMEOUT_TOTAL,
          type: METRIC.TYPE_COUNTER,
          labelNames: ['service', 'action'],
          description: '超时请求的数量',
          rate: true
        });
      }
    },
    localAction: wrapTimeoutMiddleware,
    remoteAction: wrapTimeoutMiddleware
  };
}
